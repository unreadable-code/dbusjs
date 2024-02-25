import {DataType} from ".";
import {
    Serializer,
    ScalarValue,
    Value,
    Writer,
    getValueSerializer,
    signatureSerializer,
} from "./serialization";

export const enum Kind {
    Invalid = 0,
    Call,
    Return,
    Error,
    Signal,
}

export const enum Header {
    Path = 1,
    Interface,
    Member,
    ErorrName,
    ReplySerial,
    Destination,
    Sender,
    Signature,
}

export interface Headers {
    destination?: string;
    path?: string;
    interface?: string;
    member?: string;
    replySerial?: number;
    errorName?: string;
    sender?: string;
    signature?: string;
}

interface HeaderValue {
    type: DataType;
    value: ScalarValue;
}

export class Builder {
    private readonly writer: Writer;
    private readonly headers: HeaderValue[] = [];

    constructor(kind: Kind) {
        this.writer = new Writer(new ArrayBuffer(128));

        this.writer.writeByte(108); // little endian
        this.writer.writeByte(kind);
        this.writer.writeByte(0);
        this.writer.writeByte(1); // protocol version 1
    }

    setHeader(id: Header.Path, type: DataType.ObjectPath, value: string): void;
    setHeader(id: Header.Interface, type: DataType.String, value: string): void;
    setHeader(id: Header.Member, type: DataType.String, value: string): void;
    setHeader(id: Header.ErorrName, type: DataType.String, value: string): void;
    setHeader(id: Header.ReplySerial, type: DataType.Unsigned32, value: number): void;
    setHeader(id: Header.Destination, type: DataType.String, value: string): void;
    setHeader(id: Header.Sender, type: DataType.String, value: string): void;
    setHeader(id: Header.Signature, type: DataType.TypeSignature, value: string): void;
    setHeader(id: number, type: DataType, value: ScalarValue): void {
        this.headers[id] = {type, value};
        this.writer.seek(16);
    }

    build(serial: number, serializer: Serializer, values: ReadonlyArray<Value>): ArrayBuffer {
        if (this.writer.position === 16) {
            for (let n = 1; n < this.headers.length; ++n) {
                const header = this.headers[n];
                if (header) {
                    this.writer.writeByte(n);
                    signatureSerializer.serializeInto(this.writer, header.type);
                    getValueSerializer(header.type)
                        .serializeInto(this.writer, header.value);
                }
            }

            // header fields array size is always aligned at 12
            this.writer.view.setUint32(12, this.writer.position, true);
        } else {
            this.writer.seek(this.writer.view.getUint32(12, true));
        }

        // must ensure body is aligned to 8 bytes
        this.writer.pad(8);
        const bodyStart = this.writer.position;

        const bodySize = serializer.estimateBytesLength(values);
        this.writer.view.buffer.resize(this.writer.position + bodySize);
        serializer.serializeInto(this.writer, values);
        this.writer.view.setUint32(4, bodyStart - this.writer.position, true);

        this.writer.view.setUint32(8, serial, true);

        return this.writer.cloneData();
    }
}
