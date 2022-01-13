import SerialPort from "serialport";
import minimist from "minimist";
import { NstrumentaClient } from "nstrumenta";
import fs from "fs";
import ws from "ws";
import readline from "readline";
import { Encoder } from "./Encoder";
import { Decoder } from "./Decoder";

const argv = minimist(process.argv.slice(2));
const wsUrl = argv.wsUrl;
const apiKey = argv.apiKey;

const debug = argv.debug ? argv.debug : false;

let serialPort: SerialPort | undefined = undefined;

const nst = wsUrl ? new NstrumentaClient({ apiKey, wsUrl }) : null;
if (nst) {
  console.log("nst wsUrl:", wsUrl);
}

nst?.addListener("open", () => {
  console.log("nstrumenta open");
  scan();
});
// start scan if nst not set
if (!nst) {
  scan();
}

nst?.init(ws as any);

const serialDevices = [
  {
    name: "trax2",
    vendorId: "0403",
    productId: "6001",
    baudRate: 38600,
  },
];

if (fs.existsSync("nst-serialport-config.json")) {
  console.log("nst-serialport-config.json begin:");
  const config = JSON.parse(
    fs.readFileSync("nst-serialport-config.json", "utf8")
  );
  config.devices.forEach((element: any) => {
    console.dir(element);
    serialDevices.push(element);
  });
  console.log("nst-serialport-config.json end");
}


function match(devicePort: SerialPort.PortInfo, device: { name?: string; vendorId: any; productId: any; baudRate?: number; path?: any; }) {
  let match: boolean | "" | undefined = false;
  // match on path from config file
  if (device.path) {
    match = device.path === devicePort.path;
  }
  // match on vId and pId
  match =
    devicePort.vendorId &&
    devicePort.vendorId.toLowerCase() === device.vendorId &&
    devicePort.productId &&
    devicePort.productId.toLowerCase() === device.productId;
  return match;
}

let isFirstPort = true;
function scan() {
  SerialPort.list().then((devicePorts) => {
    devicePorts.forEach(function (devicePort) {
      console.dir(devicePort);
      // look for device in list
      serialDevices.forEach((device) => {
        const serialDevice = device;
        if (match(devicePort, device)) {
          console.log("connecting to", devicePort.path, serialDevice.name);
          serialPort = new SerialPort(devicePort.path, {
            baudRate: device.baudRate,
          });

          serialPort.on("open", function () {
            nst?.send("serialport-events", { "type": "open", serialDevice });
            nst?.subscribe("trax-in", (message: number[]) => {
              const bytes = new Uint8Array(message);
              console.log("trax-in", bytes);
              serialPort?.write(Array.from(bytes));
            });
          });

          serialPort.on("error", function (err) {
            console.error(err);
          });

          if (isFirstPort) {
            // Only CLI for the first trax2 opened...
            isFirstPort = false;
            startCli(serialPort, serialDevice);
          } else {
            serialPort.on("data", function (data) {
              switch (serialDevice.name) {
                default:
                  nst?.send(serialDevice.name, data);
                  break;
              }
            });
          }
        }
      });
    });
  });
}

interface SerialDevice {
  name: string;
  vendorId: string;
  productId: string;
  baudRate: number;
}

function startCli(serialPort: SerialPort, serialDevice: SerialDevice) {
  // Start a simple interactive cli to test trax2.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // TODO: Add more commands. Also debate on if 'k' should be in format (to match documentation).
  const Commands = {
    GetModInfo: "GetModInfo",
    SerialNumber: "SerialNumber",
  };

  let timeout: ReturnType<typeof setTimeout> | null = null;
  let command = "";
  const encoder = new Encoder();
  const decoder = new Decoder();

  const sendRequest = (bytes: Uint8Array) => {
    timeout = setTimeout(() => {
      console.log(`Command '${command}' timed out!`);
      command = "";
      makePrompt();
    }, 5000);
    serialPort.write(Array.from(bytes));
  };

  const makePrompt = () => {
    rl.question("trax2 % ", (answer: string) => {
      const trimmedAnswer = answer.trim();
      if (!trimmedAnswer) {
        makePrompt();
        return;
      }

      const parts = trimmedAnswer.split(/\s+/);
      command = parts[0];
      switch (command) {
        case Commands.GetModInfo: {
          sendRequest(encoder.getModuleInfo());
          break;
        }

        case Commands.SerialNumber: {
          sendRequest(encoder.getSerialNumber());
          break;
        }

        default:
          console.log("Unknown command: ", command);
          makePrompt();
          break;
      }
    });
  };

  serialPort.on("data", function (data) {
    decoder.decode(new Uint8Array(data));
    switch (serialDevice.name) {
      default:
        nst?.send(serialDevice.name, data);
        break;
    }
  });

  decoder.onGetModuleInfo = (frame) => {
    if (command !== Commands.GetModInfo) { return; }
    if (timeout) {
      clearTimeout(timeout);
    }
    console.log(`GetModInfo: '${frame.name} ${frame.rev}'`);
    makePrompt();
  };

  decoder.onGetSerialNumber = (frame) => {
    if (command !== Commands.SerialNumber) { return; }
    if (timeout) {
      clearTimeout(timeout);
    }
    console.log(`SerialNumber: '${frame.serialNumber}'`);
    makePrompt();
  };

  makePrompt();
}
