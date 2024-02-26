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
        this.writer = new Writer(new ArrayBuffer(256, {maxByteLength: 1 << 27}));

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
    }

    private writeHeader(id: Header, type: DataType, value: ScalarValue) {
        const serializer = getValueSerializer(type);
        const required = 4 + serializer.estimateBytesLength(value);
        const {buffer} = this.writer.view;
        if (required > buffer.byteLength - this.writer.position)
            buffer.resize(buffer.byteLength * 2);

        this.writer.writeByte(id);
        signatureSerializer.serializeInto(this.writer, type);
        serializer.serializeInto(this.writer, value);
    }

    build(serializer: Serializer, values: ReadonlyArray<Value>): ArrayBuffer {
        this.writer.seek(16);

        for (let n = 1; n < this.headers.length; ++n) {
            const header = this.headers[n];
            if (header)
                this.writeHeader(n, header.type, header.value);
        }

        this.writeHeader(Header.Signature, DataType.TypeSignature, serializer.signature);

        // header fields array size is always aligned at 12
        this.writer.view.setUint32(12, this.writer.position, true);

        // must ensure body is aligned to 8 bytes
        this.writer.pad(8);
        const bodyStart = this.writer.position;

        const bodySize = serializer.estimateBytesLength(values);
        this.writer.view.buffer.resize(this.writer.position + bodySize);
        serializer.serializeInto(this.writer, values);
        this.writer.view.setUint32(4, bodyStart - this.writer.position, true);

        return this.writer.cloneData();
    }
}

const utf8Decoder = new TextDecoder("utf8");

export class Reader {
    private offset: number = 16;

    constructor(readonly view: DataView) {
        // do nothing
    }

    get position(): number {
        return this.offset;
    }

    getHeaderFieldsSize(): number {
        return this.view.getUint32(12, true);
    }

    getBodySize(): number {
        return this.view.getUint32(4, true);
    }

    getSerial(): number {
        return this.view.getUint32(8, true);
    }

    readUint8(): number {
        const result = this.view.getUint8(this.offset);
        ++this.offset;
        return result;
    }

    readUint16(): number {
        const result = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return result;
    }

    readUint32(): number {
        const result = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return result;
    }

    readUint64(): bigint {
        const result = this.view.getBigUint64(this.offset, true);
        this.offset += 8;
        return result;
    }

    decodeString(length: number): string {
        const offset = this.view.byteOffset + this.offset;
        return utf8Decoder.decode(new Uint8Array(this.view.buffer, offset, length));
    }

    readString(): string {
        return this.decodeString(this.readUint32());
    }

    readSignature(): string {
        return this.decodeString(this.readUint8());
    }

    readHeaderField(): [id: number, type: DataType, value: ScalarValue] {
        const id = this.readUint8();
        const type = this.readSignature();
        switch (type) {
        case DataType.String:
        case DataType.ObjectPath:
            return [id, type, this.readString()];

        case DataType.Unsigned32:
            return [id, type, this.readUint32()];

        case DataType.TypeSignature:
            return [id, type, this.readSignature()];
        }

        throw new Error("Unrecognized header data");
    }

    skipToBody(): void {
        const p = 16 + this.getHeaderFieldsSize();
        this.offset = 8 + Math.floor(p / 8);
    }
}