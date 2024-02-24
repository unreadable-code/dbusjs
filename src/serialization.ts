import {DataType, MessageType, type Headers} from ".";

export class SerializationError extends Error {
    constructor(
        public readonly signature: string,
        public readonly data: unknown,
        message: string,
    ) {
        super(message);
    }
}

class Writer {
    private offset: number = 0;
    private readonly view: DataView;

    constructor(buffer: ArrayBuffer) {
        this.view = new DataView(buffer);
    }

    get position(): number {
        return this.offset;
    }

    pad(length: number): void {
        length -= this.offset % length;
        new Uint8Array(this.view.buffer, this.offset, length);
        this.offset += length;
    }

    private encodeString(value: string): number {
        const allocated = value.length;
        const strview = new Uint8Array(this.view.buffer, this.offset, allocated);
        const progress = new TextEncoder().encodeInto(value, strview);
        if (progress.read < value.length) {
            // TODO: handle resizing
        }

        return allocated;
    }

    writeString(value: string): void {
        this.pad(4);
        this.view.setUint32(this.offset, value.length, true);
        this.offset += 5 + this.encodeString(value);
        this.view.setUint8(this.offset - 1, 0);
    }

    writeSignature(value: string): void {
        this.view.setUint8(this.offset, value.length);
        this.offset += 2 + this.encodeString(value);
        this.view.setUint8(this.offset - 1, 0);
    }

    writeByte(value: number): void {
        this.view.setUint8(this.offset, value);
        ++this.offset;
    }

    writeBool(value: boolean): void {
        this.pad(4);
        this.view.setUint32(this.offset, value ? 1 : 0, true);
        this.offset += 4;
    }

    writeInt16(value: number): void {
        this.pad(2);
        this.view.setInt16(this.offset, value, true);
        this.offset += 2;
    }

    writeUInt16(value: number): void {
        this.pad(2);
        this.view.setUint16(this.offset, value, true);
        this.offset += 2;
    }

    writeInt32(value: number): void {
        this.pad(4);
        this.view.setInt32(this.offset, value, true);
        this.offset += 4;
    }

    deferUInt32(): (value: number) => void {
        this.pad(4);
        const position = this.offset;
        this.offset += 4;
        return value => this.view.setUint32(position, value, true);
    }

    writeUInt32(value: number): void {
        this.pad(4);
        this.view.setUint32(this.offset, value, true);
        this.offset += 4;
    }

    writeInt64(value: bigint): void {
        this.pad(8);
        this.view.setBigInt64(this.offset, value, true);
        this.offset += 8;
    }

    writeUInt64(value: bigint): void {
        this.pad(8);
        this.view.setBigUint64(this.offset, value, true);
        this.offset += 8;
    }

    writeDouble(value: number): void {
        this.pad(8);
        this.view.setFloat64(this.offset, value, true);
        this.offset += 8;
    }

    append(value: Uint8Array): void {
        new Uint8Array(this.view.buffer).set(value, this.offset);
        this.offset += value.length;
    }
}

type Value = number | string | boolean | bigint | Uint8Array | ReadonlyArray<Value>;

interface Serializer {
    estimateBytesLength(value: Value): number;
    serializeInto(writer: Writer, value: Value): void;
}

interface WriterMethodErasure {
    (value: Value): void;
}


class PrimitiveSerializer implements Serializer {
    private readonly method: (this: Writer, value: Value) => void;

    constructor(
        private readonly bytes: number,
        method: typeof Writer.prototype[keyof typeof Writer.prototype],
    ) {
        this.method = method as WriterMethodErasure;
    }

    estimateBytesLength(): number {
        return this.bytes;
    }

    serializeInto(writer: Writer, value: Value): void {
        this.method.call(writer, value);
    }

    static instances: {[K in DataType[number]]: PrimitiveSerializer} = {
        [DataType.Byte]: new PrimitiveSerializer(1, Writer.prototype.writeByte),
        [DataType.Boolean]: new PrimitiveSerializer(4, Writer.prototype.writeBool),
        [DataType.Int16]: new PrimitiveSerializer(2, Writer.prototype.writeInt16),
        [DataType.Int32]: new PrimitiveSerializer(4, Writer.prototype.writeInt32),
        [DataType.Int64]: new PrimitiveSerializer(8, Writer.prototype.writeInt64),
        [DataType.Unsigned16]: new PrimitiveSerializer(2, Writer.prototype.writeUInt16),
        [DataType.Unsigned32]: new PrimitiveSerializer(4, Writer.prototype.writeUInt32),
        [DataType.Unsigned64]: new PrimitiveSerializer(8, Writer.prototype.writeUInt64),
        [DataType.Double]: new PrimitiveSerializer(8, Writer.prototype.writeDouble),
        // TODO: "h": new PrimitiveSerializer(4, Writer.prototype.writeUInt32),
    };
}

class StructSerializer implements Serializer {
    constructor(protected readonly fields: Serializer[]) {
        // do nothing
    }

    estimateBytesLength(value: Value): number {
        const values = value as ReadonlyArray<Value>;

        let result = 0;
        for (let n = 0; n < this.fields.length; ++n)
            result += this.fields[n].estimateBytesLength(values[n]);

        return result;
    }

    serializeInto(writer: Writer, value: Value): void {
        const values = value as ReadonlyArray<Value>;

        for (let n = 0; n < this.fields.length; ++n)
            this.fields[n].serializeInto(writer, values[n]);
    }

}

class ArraySerializer extends StructSerializer {
    estimateBytesLength(value: Value): number {
        const values = value as ReadonlyArray<Value>;

        let result = 0;
        for (let n = 0; n < values.length; ++n)
            result += super.estimateBytesLength(values[n]);

        return result;
    }

    serializeInto(writer: Writer, value: Value): void {
        const values = value as ReadonlyArray<Value>;

        const count = values.length;
        const startingPosition = writer.position;
        const deferred = writer.deferUInt32();
        for (let n = 0; n < count; ++n)
            super.serializeInto(writer, values[n]);

        deferred(writer.position - startingPosition - 4);
    }
}

class StringSerializer implements Serializer {
    estimateBytesLength(value: Value): number {
        return 5 + (value as string).length;
    }

    serializeInto(writer: Writer, value: Value): void {
        writer.writeString(value as string)
    }

    static readonly instance = new StringSerializer();
}

class SignatureSerializer implements Serializer {
    estimateBytesLength(value: Value): number {
        return 2 + (value as string).length;
    }

    serializeInto(writer: Writer, value: Value): void {
        writer.writeSignature(value as string)
    }

    static readonly instance = new SignatureSerializer();
}

class PassthroughSerializer implements Serializer {
    estimateBytesLength(value: Value): number {
        return (value as Uint8Array).length;
    }

    serializeInto(writer: Writer, value: Value): void {
        writer.append(value as Uint8Array);
    }

    static readonly instance = new PassthroughSerializer();
}

export const emptySerializer = new StructSerializer([]);

const enum CompositeKind {
    Array = "a",
    Struct = "(",
    Dictionary = "{",
}

class CompositeSerializerBuilder {
    readonly elements: Serializer[] = [];

    constructor(readonly kind: CompositeKind) {
        // do nothing
    }

    build(signature: string): StructSerializer {
        if (this.elements.length < 1)
            throw new Error(`Empty composite type in dbus signature: ${signature}`);

        return new StructSerializer(this.elements);
    }
}

class SerializerBuilder {
    readonly incomplete: CompositeSerializerBuilder[];
    current: CompositeSerializerBuilder;

    constructor() {
        this.current = new CompositeSerializerBuilder(CompositeKind.Struct);
        this.incomplete = [this.current];
    }

    add(serializer: Serializer): void {
        this.current.elements.push(serializer);
    }

    addPrimitive(token: string): boolean {
        const candidate = PrimitiveSerializer.instances[token];
        if (candidate) {
            this.current.elements.push(candidate);
            return true;
        }

        return false;
    }

    beginComposite(kind: CompositeKind): void {
        this.current = new CompositeSerializerBuilder(kind);
        this.incomplete.push(this.current);
    }

    endComposite(kind: CompositeKind, signature: string): void {
        if (this.current.kind !== kind)
            throw new Error(`Composite type mismatch in DBus signature: ${signature}`);

        do {
            const s = this.current.build(signature);
            this.current = this.incomplete.pop()!;
            this.current.elements.push(s);
        } while (this.current.kind === CompositeKind.Array);
    }

    build(signature: string): StructSerializer {
        if (this.incomplete.length > 1)
            throw new Error(`Incomplete DBus signature: ${signature}`);

        return this.current.build(signature);
    }
}

// type ReservedTypeCode = "rem*?@&^";

export function parseSignature(signature: string): StructSerializer {
    const builder = new SerializerBuilder();

    let index = 0;
    while (index < signature.length) {
        const token = signature[index];

        switch (token) {
        case CompositeKind.Array:
        case CompositeKind.Dictionary:
        case CompositeKind.Struct:
            builder.beginComposite(token);
            break;

        case "}":
            builder.endComposite(CompositeKind.Dictionary, signature);
            break;

        case ")":
            builder.endComposite(CompositeKind.Struct, signature);
            break;

        case "o":
            // TODO: add validation
        case "s":
            builder.add(StringSerializer.instance);
            break;

        case "g":
            builder.add(SignatureSerializer.instance);
            break;

        case "v":
            builder.add(PassthroughSerializer.instance);
            break;

        default:
            if (!builder.addPrimitive(token))
                throw new Error(`Unrecognized token "${token}" in DBus signature: ${signature}`);
        }

        ++index;
    }

    return builder.build(signature);
}

interface FieldDefinition {
    id: number,
    type: DataType,
}

const headerDefinitions: Record<string, FieldDefinition> = {
    "path": {
        id: 1,
        type: DataType.ObjectPath,
    },
    "interface": {
        id: 2,
        type: DataType.String,
    },
    "member": {
        id: 3,
        type: DataType.String,
    },
    "errorName": {
        id: 4,
        type: DataType.String,
    },
    "replySerial": {
        id: 5,
        type: DataType.Unsigned32,
    },
    "destination": {
        id: 6,
        type: DataType.String,
    },
    "sender": {
        id: 7,
        type: DataType.String,
    },
    "signature": {
        id: 8,
        type: DataType.TypeSignature,
    },
};

export function serializeMessage(
    serial: number,
    headers: Headers,
    serializer: Serializer,
    values: ReadonlyArray<Value>,
): Uint8Array {
    const headerSerializers = [];
    const headerValues: Value[] = [];
    for (const propertyName of Object.keys(headers)) {
        const definition = headerDefinitions[propertyName];
        if (definition) {
            headerSerializers.push(PrimitiveSerializer.instances[definition.type]);
            headerValues.push(headers[propertyName as keyof Headers]!);
        }
    }

    const headerSerializer = new StructSerializer(headerSerializers);
    const headerSize = headerSerializer.estimateBytesLength(headerValues);
    const bodySize = serializer.estimateBytesLength(values);

    const paddedHeaderSize = 12 + 8 * Math.trunc(1 + headerSize / 8);
    const buffer = new ArrayBuffer(paddedHeaderSize + bodySize);
    const writer = new Writer(buffer);

    // serialize the static part header (12 bytes)
    writer.writeByte(108); // little endian
    writer.writeByte(MessageType.MethodCall);
    writer.writeByte(0);
    writer.writeByte(1); // protocol version 1
    writer.writeUInt32(paddedHeaderSize);
    writer.writeUInt32(serial);

    // serialize the variable part of the header
    headerSerializer.serializeInto(writer, headerValues);
    writer.pad(8);

    // serialize the arguments
    serializer.serializeInto(writer, values);

    return new Uint8Array(buffer);
}
