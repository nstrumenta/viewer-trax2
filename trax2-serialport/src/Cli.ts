import readline from "readline";

import Commander from "commander";
import SerialPort from "serialport";

import { Encoder } from "./Encoder";
import { Decoder } from "./Decoder";
import * as Protocol from "./Protocol";

// This doesn't hook into Nstrumenta yet. That is TODO.
export default class Cli {
  isStarted = false;
  debug = false;
  serialPort: SerialPort;

  private rl: readline.Interface;
  private encoder = new Encoder();
  private decoder = new Decoder();
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private program: Commander.Command;
  private curretCommand = "";
  private promptOpen = false;

  constructor(serialPort: SerialPort) {
    this.serialPort = serialPort;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.program = new Commander.Command("trax2");
    this.program.name("trax2 %");
    this.program.usage("[command] [args]");

    const cmds: Commander.Command[] = [this.program];

    cmds.push(this.program.command(Commands.kGetModInfo)
      .description("Queries the device's type and firmware revision.")
      .action(() => this.getModuleInfo()));

    cmds.push(this.program.command(Commands.kSetDataComponents)
      .description(`Sets the data components to be output.\n- Format: '${Commands.kSetDataComponents} comp1 comp2 compN'\n- Run '${Commands.kSetDataComponents} -h' to view available components.`)
      .option(Components.kHeading, "Compass heading, range [0 ̊, 360 ̊).")
      .option(Components.kPitch, "Compass Pitch, range [-90 ̊, 90 ̊].")
      .option(Components.kRoll, "Compass Roll, range [-180 ̊, 180 ̊].")
      .option(Components.kHeadingStatus, "Indication of the uncertainty of the heading.\n- Value '1' represents a heading uncertainty of <2°.\n- Value '2' means the heading uncertainty is approximately 2° to 10°.\n- Value '3' means the uncertainty is >10°.")
      .option(Components.kQuaternion, "The quaternions are output as Q0, Q1, Q2, and Q3, where Q3 is the scalar quaternion.")
      .option(Components.kTemperature, "The device's internal temperature sensor. Its value is in degrees Celsius and has an accuracy of ±3° C.")
      .option(Components.kDistortion, "This flag indicates at least one magnetometer axis reading is beyond ±125 μT.\n- It is only applicable in Compass Mode, and will always read “FALSE” in AHRS Mode.")
      .option(Components.kCalStatus, "This flag indicates the user calibration status.\n- False means it is not user calibrated and this is the default value.")
      .option(Components.kAccelX, "Accelerometer X axis (g).")
      .option(Components.kAccelY, "Accelerometer Y axis (g).")
      .option(Components.kAccelZ, "Accelerometer Z axis (g).")
      .option(Components.kMagX, "Magnetometer X axis (μT).")
      .option(Components.kMagY, "Magnetometer Y axis (μT).")
      .option(Components.kMagZ, "Magnetometer Z axis (μT).")
      .option(Components.kGyroX, "Gyroscope X axis (radians per second).")
      .option(Components.kGyroY, "Gyroscope Y axis (radians per second).")
      .option(Components.kGyroZ, "Gyroscope Z axis (radians per second).")
      .action((args: string[]) => this.setDataComponents(args)));

    cmds.push(this.program.command(Commands.kGetData)
      .description("Queries the TRAX2 for data.")
      .action(() => this.getData()));

    cmds.push(this.program.command(Commands.kGetAcqParams)
      .description("Get the sensor acquisition parameters in the TRAX2.")
      .action(() => this.getAcquisitionParams()));

    cmds.push(this.program.command(Commands.kSetAcqParams)
      .description("Set the sensor acquisition parameters in the TRAX2.")
      .usage("<mode> [options]")
      .argument("<mode>", "Set '0' for Continuous Mode or '1' for Polled Acquisition Mode.", (value) => {
        const int = Number(value);
        if (Number.isNaN(int) || (int !== 0 && int !== 1)) {
          throw new Commander.InvalidArgumentError("Must be '0' or '1'.");
        }
        return String(int);
      })
      .option("-ff, --flush-filter <number>", "Results in the FIR filter being flushed after every measurement.\n- Set '1' to enable and '0' to disable.", (value) => {
        const int = Number(value);
        if (Number.isNaN(int) || (int !== 0 && int !== 1)) {
          throw new Commander.InvalidArgumentError("Must be '0' or '1'.");
        }
        return String(int);
      }, "0")
      .option("-d, --delay <float>", "Time delay in seconds for Continuous Mode.", (value) => {
        const float = Number(value);
        if (Number.isNaN(float)) {
          throw new Commander.InvalidArgumentError("Must be a float.");
        }
        return String(float);
      }, "0")
      .action((args: string[], options: { flushFilter: number, delay: number }) => this.setAcquisitionParams(args, options)));

    cmds.push(this.program.command(Commands.kSerialNumber)
      .description("Request Serial Number of TRAX2 unit.")
      .action(() => this.getSerialNumber()));

    cmds.push(this.program.command(Commands.kSetFunctionalMode)
      .description("Set the TRAX2 functional mode.")
      .argument("<mode>", "Set '0' to operate in Compass Mode or '1' to operate in AHRS Mode.", (value) => {
        const int = Number(value);
        if (Number.isNaN(int) || (int !== 0 && int !== 1)) {
          throw new Commander.InvalidArgumentError("Must be '0' or '1'.");
        }
        return String(int);
      })
      .action((args: string[]) => this.setFunctionalMode(args)));

    cmds.push(this.program.command(Commands.kGetFunctionalMode)
      .description("Get the TRAX2 functional mode.")
      .action(() => this.getFunctionalMode()));

    cmds.push(this.program.command(Commands.kSetResetRef)
      .description("Re-aligns the TRAX2 9-axis heading to the 6-axis (mag and accel) heading\nand establishes the criteria for the reference magnetic field.")
      .action(() => this.resetRef()));

    cmds.push(this.program.command(Commands.exit)
      .description("End the session.")
      .action(() => process.exit())); // TODO: Maybe just end readline?

    for (const cmd of cmds) {
      // The default behavior is to kill the process if the module reaches an 'error state'.
      // This can happen if the user asks for help, enters an invalid command, has missing required arguments, etc...
      // This stops that and restarts the prompt.
      cmd.exitOverride(); // throw instead of exit
      cmd.on("afterHelp", () => this.makePrompt());
    }

    this.setDecoderCallbacks();
  }

  start() {
    if (this.isStarted) { return; }
    this.isStarted = true;

    this.serialPort.on("data", (data) => {
      this.decoder.decode(new Uint8Array(data));
    });

    this.makePrompt();
  }

  private makePrompt() {
    this.promptOpen = true;
    this.rl.question("trax2 % ", (answer: string) => {
      this.promptOpen = false;
      const trimmedAnswer = answer.trim();
      if (!trimmedAnswer) {
        this.makePrompt();
        return;
      }

      const parts = trimmedAnswer.split(/\s+/);
      if (this.debug) {
        console.log("User input: ", parts);
      }
      try {
        this.program.parse(parts, { from: "user" });
      } catch (err) {
        if (this.debug) {
          if (isCommanderError(err)) {
            console.log(`Commander parse error: { "code": "${err.code}", "message": "${err.message}" }`);
          } else {
            console.log("Commander parse error:", err);
          }
          if (this.promptOpen) {
            this.makePrompt();
          }
        }

        if (isCommanderError(err)) {
          switch (err.code) {
            case "commander.unknownCommand":
              this.program.outputHelp();
              break;
            case "commander.help":
              break; // Rely on 'afterHelp' event to handle this.
            default:
              this.makePrompt();
              break;
          }
        } else {
          this.makePrompt();
        }
      }
    });
  }

  private sendRequest(bytes: Uint8Array, startNewTimeout = true) {
    if (startNewTimeout) {
      this.timeout = setTimeout(() => {
        console.log(`Command '${this.curretCommand}' timed out!`);
        this.curretCommand = "";
        this.makePrompt();
      }, 5000);
    } else {
      // This request doesn't have a response, sp wait 1 second.
      setTimeout(() => {
        this.makePrompt();
      }, 1000);
    }

    this.serialPort.write(Array.from(bytes));
  }

  private resetState() {
    this.curretCommand = "";
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
  }

  private getModuleInfo() {
    this.curretCommand = Commands.kGetModInfo;
    this.sendRequest(this.encoder.getModuleInfo());
  }

  private setDataComponents(args: string[]) {
    const components: number[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const component = getComponentId(arg);
      if (typeof component === "number") {
        components.push(component);
      } else {
        console.log(`Unknown component: '${arg}'`);
      }
    }

    if (components.length) {
      this.sendRequest(this.encoder.setDataComponents(components), false);
    } else {
      console.log("No components were provided");
      this.makePrompt();
    }
  }

  private getData() {
    this.curretCommand = Commands.kGetData;
    this.sendRequest(this.encoder.getData());
  }

  private getAcquisitionParams() {
    this.curretCommand = Commands.kGetAcqParams;
    this.sendRequest(this.encoder.getAcquisitionParams());
  }

  private setAcquisitionParams(args: string[], options: { flushFilter: number, delay: number }) {
    if (!args.length) {
      console.log("The mode argument was not provided.");
      this.makePrompt();
      return;
    }

    const mode = Number(args[0]);
    this.curretCommand = Commands.kSetAcqParams;
    this.sendRequest(this.encoder.setAcquisitionParams(mode !== 0, options.flushFilter !== 0, options.delay));
  }

  private getSerialNumber() {
    this.curretCommand = Commands.kSerialNumber;
    this.sendRequest(this.encoder.getSerialNumber());
  }

  private setFunctionalMode(args: string[]) {
    if (!args.length) {
      console.log("The mode argument was not provided.");
      this.makePrompt();
      return;
    }

    const mode = Number(args[0]);
    this.sendRequest(this.encoder.setFunctionalMode(mode !== 0), false);
  }

  private getFunctionalMode() {
    this.curretCommand = Commands.kGetFunctionalMode;
    this.sendRequest(this.encoder.getFunctionalMode());
  }

  private resetRef() {
    this.sendRequest(this.encoder.resetRef(), false);
  }

  private setDecoderCallbacks() {
    this.decoder.onGetModuleInfo = (frame) => {
      if (this.curretCommand !== Commands.kGetModInfo) { return; }
      this.resetState();
      console.log(`GetModInfo: '${frame.name} ${frame.rev}'.`);
      this.makePrompt();
    };

    this.decoder.onGetSerialNumber = (frame) => {
      if (this.curretCommand !== Commands.kSerialNumber) { return; }
      this.resetState();
      console.log(`SerialNumber: '${frame.serialNumber}'.`);
      this.makePrompt();
    };

    this.decoder.onGetData = (frame) => {
      // For now only support poll mode since continuous spams the console too much.
      if (this.curretCommand !== Commands.kGetData) { return; }
      this.resetState();
      console.log(frame.components);
      this.makePrompt();
    };

    this.decoder.onGetAcquisitionParams = (frame) => {
      if (this.curretCommand !== Commands.kGetAcqParams) { return; }
      this.resetState();
      console.log(`Acquisition params: '${frame.isPollMode ? "Polled" : "Continuous"} Mode', 'flushFilters=${frame.flushFilters}', 'sampleDelay=${Number(frame.sampleDelay.toPrecision(5))}'.`);
      this.makePrompt();
    };

    this.decoder.onSetAcquisitionParams = () => {
      if (this.curretCommand !== Commands.kSetAcqParams) { return; }
      this.resetState();
      console.log("Acquisition params were set.");
      this.makePrompt();
    };

    this.decoder.onGetFunctionalMode = (frame) => {
      if (this.curretCommand !== Commands.kGetFunctionalMode) { return; }
      this.resetState();
      console.log(`FunctionalMode: '${frame.isAhrsMode ? "AHRS Mode" : "Compass Mode"}'`);
      this.makePrompt();
    };
  }
}

// TODO: Add more commands. Also debate on if 'k' should be in format (to match documentation).
enum Commands {
  kGetModInfo = "kGetModInfo",
  kSetDataComponents = "kSetDataComponents",
  kGetData = "kGetData",
  kStartContinuousMode = "kStartContinuousMode",
  kGetAcqParams = "kGetAcqParams",
  kSetAcqParams = "kSetAcqParams",
  kSerialNumber = "kSerialNumber",
  kSetFunctionalMode = "kSetFunctionalMode",
  kGetFunctionalMode = "kGetFunctionalMode",
  kSetResetRef = "kSetResetRef",

  exit = "exit",
}

enum Components {
  kHeading = "kHeading",
  kDistortion = "kDistortion",
  kCalStatus = "kCalStatus",
  kTemperature = "kTemperature",
  kAccelX = "kAccelX",
  kAccelY = "kAccelY",
  kAccelZ = "kAccelZ",
  kPitch = "kPitch",
  kRoll = "kRoll",
  kMagX = "kMagX",
  kMagY = "kMagY",
  kMagZ = "kMagZ",
  kGyroX = "kGyroX",
  kGyroY = "kGyroY",
  kGyroZ = "kGyroZ",
  kQuaternion = "kQuaternion",
  kHeadingStatus = "kHeadingStatus",
}

function getComponentId(component: string) {
  switch (component) {
    case Components.kHeading:
      return Protocol.ComponentId.Heading;
    case Components.kDistortion:
      return Protocol.ComponentId.Distortion;
    case Components.kCalStatus:
      return Protocol.ComponentId.CalStatus;
    case Components.kTemperature:
      return Protocol.ComponentId.Temperature;
    case Components.kAccelX:
      return Protocol.ComponentId.AccelX;
    case Components.kAccelY:
      return Protocol.ComponentId.AccelY;
    case Components.kAccelZ:
      return Protocol.ComponentId.AccelZ;
    case Components.kPitch:
      return Protocol.ComponentId.Pitch;
    case Components.kRoll:
      return Protocol.ComponentId.Roll;
    case Components.kMagX:
      return Protocol.ComponentId.MagX;
    case Components.kMagY:
      return Protocol.ComponentId.MagY;
    case Components.kMagZ:
      return Protocol.ComponentId.MagZ;
    case Components.kGyroX:
      return Protocol.ComponentId.GyroX;
    case Components.kGyroY:
      return Protocol.ComponentId.GyroY;
    case Components.kGyroZ:
      return Protocol.ComponentId.GyroZ;
    case Components.kQuaternion:
      return Protocol.ComponentId.Quaternion;
    case Components.kHeadingStatus:
      return Protocol.ComponentId.HeadingStatus;
    default:
      return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isCommanderError (x: any): x is Commander.CommanderError {
  return typeof x.code === "string";
}
