import * as Protocol from "./Protocol";
import calculateCrc16 from "./calculateCrc16";

/**
 * Trax2 response data decoder.
 * It is up to the caller to register callbacks for frame types they wish to consume.
 */
export class Decoder {
  count: number;
  isProcessing: boolean;
  skipCrc8ErrorFrame: boolean;
  private unprocessedBytes?: Uint8Array;

  onGetModuleInfo?: (frame: Frames.ModuleInfo) => void;
  onGetSerialNumber?: (frame: Frames.SerialNumber) => void;
  onSetAcquisitionParams?: (frame: Frames.Base) => void;
  onGetAcquisitionParams?: (frame: Frames.AcquisitionParams) => void;
  onGetData?: (frame: Frames.Data) => void;
  onSetConfig?: (frame: Frames.Base) => void;
  onGetDeclination?: (frame: Frames.Declination) => void;
  onGetFunctionalMode?: (frame: Frames.FunctionalMode) => void;

  constructor() {
    this.count = 0;
    this.isProcessing = false;
    this.skipCrc8ErrorFrame = true;
  }

  decode(bytes: Uint8Array) {
    this.isProcessing = true;

    const dv = (() => {
      if (this.unprocessedBytes) {
        const combinedBytes = new Uint8Array(this.unprocessedBytes.byteLength + bytes.byteLength);
        combinedBytes.set(this.unprocessedBytes, 0);
        combinedBytes.set(bytes, this.unprocessedBytes.byteLength);
        this.unprocessedBytes = undefined;
        return new DataView(combinedBytes.buffer);
      }
      return new DataView(bytes.buffer);
    })();
    console.log("GOT", dv.buffer);

    const decodeFrame = (index: number, frameLength: number) => {
      if (frameLength === 0) {
        return false;
      }

      const frameId = dv.getUint8(index + 2);
      const crc16Expected = dv.getUint16(index + frameLength - 2, false);
      const crc16 = calculateCrc16(new Uint8Array(dv.buffer.slice(index, dv.byteLength - 2)));

      let crc16ErrorStatus = false;
      if (crc16 !== crc16Expected) {
        console.log(`CRC ERROR{frameLength=${frameLength}, frameId=${frameId}, crc16xpected=${crc16Expected}, crc16Actual=${crc16}}`);
        if (this.skipCrc8ErrorFrame) {
          return false;
        }
        crc16ErrorStatus = true;
      }

      switch (frameId) {
        case Protocol.FrameId.GetModInfoResp:
          if (frameLength !== 13) {
            return false;
          }
          if (typeof this.onGetModuleInfo === "function") {
            const textDecoder = new TextDecoder();
            this.onGetModuleInfo({
              name: textDecoder.decode(dv.buffer.slice(index + 3, index + 7)),
              rev: textDecoder.decode(dv.buffer.slice(index + 7, index + 11)),
              id: frameId,
              crc16ErrorStatus,
              crc16Expected,
            });
          }
          return true;
        case Protocol.FrameId.GetDataResp: {
          if (frameLength < 6) {
            return false;
          }
          const components: Frames.Data.Component[] = [];

          const componentCount = dv.getUint8(index + 3);
          let i = 4;
          let currentComponent = 0;
          let unknownComponentFound = false;
          while (i < frameLength && currentComponent < componentCount && !unknownComponentFound) {
            const componentId = dv.getUint8(index + i);
            switch (componentId) {
              case Protocol.ComponentId.Heading:
              case Protocol.ComponentId.Pitch:
              case Protocol.ComponentId.Roll:
              case Protocol.ComponentId.Temperature:
              case Protocol.ComponentId.AccelX:
              case Protocol.ComponentId.AccelY:
              case Protocol.ComponentId.AccelZ:
              case Protocol.ComponentId.MagX:
              case Protocol.ComponentId.MagY:
              case Protocol.ComponentId.MagZ:
              case Protocol.ComponentId.GyroX:
              case Protocol.ComponentId.GyroY:
              case Protocol.ComponentId.GyroZ:
                if (frameLength < i + 2 + 4) {
                  return false;
                }
                components.push({
                  id: componentId,
                  values: [dv.getFloat32(index + i + 1)],
                });
                i += 5;
                break;
              case Protocol.ComponentId.HeadingStatus:
              case Protocol.ComponentId.Distortion:
              case Protocol.ComponentId.CalStatus:
                if (frameLength < i + 2 + 1) {
                  return false;
                }
                components.push({
                  id: componentId,
                  values: [dv.getUint8(index + i + 1)],
                });
                i += 2;
                break;
              case Protocol.ComponentId.Quaternion:
                if (frameLength < i + 2 + 16) {
                  return false;
                }
                components.push({
                  id: componentId,
                  values: [
                    dv.getFloat32(index + i + 1),
                    dv.getFloat32(index + i + 5),
                    dv.getFloat32(index + i + 9),
                    dv.getFloat32(index + i + 13),
                  ],
                });
                i += 17;
                break;
              default:
                unknownComponentFound = true;
                break;
            }
            currentComponent++;
          }

          if (typeof this.onGetData === "function") {
            this.onGetData({
              components,
              id: frameId,
              crc16ErrorStatus,
              crc16Expected,
            });
          }
          return true;
        }
        case Protocol.FrameId.GetConfigResp: {
          if (frameLength < 7) {
            return false;
          }
          const configId = dv.getUint8(index + 3);
          switch (configId) {
            case Protocol.ConfigId.Declination: {
              if (frameLength !== 10) {
                return false;
              }
              if (typeof this.onGetDeclination === "function") {
                this.onGetDeclination({
                  declination: dv.getFloat32(index + 4),
                  id: frameId,
                  crc16ErrorStatus,
                  crc16Expected,
                });
              }
              return true;
            }
            default:
              return false;
          }
        }
        case Protocol.FrameId.SetConfigDone:
          if (frameLength !== 5) {
            return false;
          }
          if (typeof this.onSetConfig === "function") {
            this.onSetConfig({
              id: frameId,
              crc16ErrorStatus,
              crc16Expected,
            });
          }
          return true;
        case Protocol.FrameId.SerialNumberResp:
          if (frameLength !== 9) {
            return false;
          }
          if (typeof this.onGetSerialNumber === "function") {
            this.onGetSerialNumber({
              serialNumber: dv.getUint32(index + 3),
              id: frameId,
              crc16ErrorStatus,
              crc16Expected,
            });
          }
          return true;
        case Protocol.FrameId.SetAcqParamsDone:
          if (frameLength !== 5) {
            return false;
          }
          if (typeof this.onSetAcquisitionParams === "function") {
            this.onSetAcquisitionParams({
              id: frameId,
              crc16ErrorStatus,
              crc16Expected,
            });
          }
          return true;
        case Protocol.FrameId.GetAcqParamsResp:
          if (frameLength !== 15) {
            return false;
          }
          if (typeof this.onGetAcquisitionParams === "function") {
            this.onGetAcquisitionParams({
              isPollMode: dv.getUint8(index + 3) !== 0,
              flushFilters: dv.getUint8(index + 4) !== 0,
              sampleDelay: dv.getFloat32(index + 9),
              id: frameId,
              crc16ErrorStatus,
              crc16Expected,
            });
          }
          return true;
        case Protocol.FrameId.GetFunctionalModeResp:
          if (frameLength !== 6) {
            return false;
          }
          if (typeof this.onGetFunctionalMode === "function") {
            this.onGetFunctionalMode({
              isAhrsMode: dv.getUint8(index + 3) !== 0,
              id: frameId,
              crc16ErrorStatus,
              crc16Expected,
            });
          }
          return true;
        default:
          console.log("Unhandled FrameId: ", frameId);
          return false;
      }
    };

    let bufferIndex = 0;
    while (this.isProcessing && bufferIndex < dv.byteLength - 3) {
      const frameLength = dv.getUint16(bufferIndex);
      if (bufferIndex + frameLength > dv.byteLength) {
        // The current frame is split into at least 2 chuncks...
        break;
      }

      const decodeSuccess = decodeFrame(bufferIndex, frameLength);
      if (decodeSuccess) {
        bufferIndex += frameLength;
      } else {
        bufferIndex++; // Move to next index and hope it aligns itself...
      }

      if (frameLength !== 0) {
        this.count += 1;
      }
    }

    if (bufferIndex < dv.byteLength) {
      this.unprocessedBytes = new Uint8Array(dv.buffer.slice(bufferIndex));
    }

    this.isProcessing = false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Frames {
  export interface Base {
    id: number;
    crc16Expected: number;
    /** If true, then the crc16 check failed on this frame. */
    crc16ErrorStatus: boolean;
  }

  export interface ModuleInfo extends Base {
    name: string;
    rev: string;
  }

  export interface SerialNumber extends Base {
    serialNumber: number;
  }

  export interface Declination extends Base {
    declination: number;
  }

  // eslint-disable-next-line @typescript-eslint/no-namespace
  export namespace Data {
    export interface Component {
      id: number;
      values: number[];
    }
  }
  export interface Data extends Base {
    components: Data.Component[];
  }

  export interface AcquisitionParams extends Base {
    isPollMode: boolean;
    flushFilters: boolean;
    sampleDelay: number;
  }

  export interface FunctionalMode extends Base {
    isAhrsMode: boolean;
  }
}
