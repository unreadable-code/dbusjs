import {DataType} from ".";

export class SerializationError extends Error {
    constructor(
        public readonly signature: string,
        public readonly data: unknown,
        message: string,
    ) {
        super(message);
    }
}

export class Writer {
    private offset: number = 0;
    readonly view: DataView;

    constructor(buffer: ArrayBuffer) {
        this.view = new DataView(buffer);
    }

    get position(): number {
        return this.offset;
    }

    pad(size: number): number {
        size -= this.offset % size;
        return this.offset += size;
    }

    seek(offset: number): void {
        this.offset = offset;
    }

    private encodeString(value: string): number {
        const allocated = value.length + 1;
        const strview = new Uint8Array(this.view.buffer, this.offset, allocated);
        const progress = new TextEncoder().encodeInto(value, strview);
        if (progress.read < value.length) {
            // TODO: handle resizing
        }

        strview[allocated - 1] = 0;
        return allocated;
    }

    writeString(value: string): void {
        const start = this.pad(4);
        this.offset += 4;

        const written = this.encodeString(value);
        this.offset += written;
        this.view.setUint32(start, written - 1, true);
    }

    writeSignature(value: string): void {
        const start = this.offset;
        ++this.offset;

        const written = this.encodeString(value);
        this.offset += written;
        this.view.setUint8(start, written - 1);
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

    cloneData(): ArrayBuffer {
        return this.view.buffer.slice(0, this.offset);
    }
}

export type ScalarValue = number | string | boolean | bigint;
export type Value = ScalarValue | Uint8Array | ReadonlyArray<Value>;

export interface Serializer {
    readonly alignment: number;
    estimateBytesLength(value: Value): number;
    serializeInto(writer: Writer, value: Value): void;
}

interface WriterMethodErasure {
    (value: Value): void;
}

class PrimitiveSerializer implements Serializer {
    private readonly method: (this: Writer, value: Value) => void;

    readonly alignment: number;

    constructor(
        bytes: number,
        method: typeof Writer.prototype[keyof typeof Writer.prototype],
    ) {
        this.alignment = bytes;
        this.method = method as WriterMethodErasure;
    }

    estimateBytesLength(): number {
        return this.alignment;
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
    alignment: number;

    constructor(protected readonly fields: Serializer[]) {
        this.alignment = fields[0].alignment;
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

        const sizeFieldPosition = writer.pad(4);

        // dbus specification says even 0 length arrays include element padding
        // and that its size field don't include said padding
        const elementsPosition = writer.pad(this.fields[0].alignment);

        const count = values.length;
        for (let n = 0; n < count; ++n)
            super.serializeInto(writer, values[n]);

        const endPosition = writer.position;
        writer.seek(sizeFieldPosition);
        writer.writeUInt32(endPosition - elementsPosition - 4);
        writer.seek(endPosition);
    }
}

ArraySerializer.prototype.alignment = 4;

class StringSerializer implements Serializer {
    alignment!: number;

    estimateBytesLength(value: Value): number {
        return 5 + (value as string).length;
    }

    serializeInto(writer: Writer, value: Value): void {
        writer.writeString(value as string)
    }

    static readonly instance = new StringSerializer();
}

StringSerializer.prototype.alignment = 4;

class SignatureSerializer implements Serializer {
    alignment!: number;

    estimateBytesLength(value: Value): number {
        return 2 + (value as string).length;
    }

    serializeInto(writer: Writer, value: Value): void {
        writer.writeSignature(value as string)
    }
}

SignatureSerializer.prototype.alignment = 1;

export const signatureSerializer = new SignatureSerializer();

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

/**
 * Get a serializer for a non-composite value
 */
export function getValueSerializer(code: DataType): Serializer;
export function getValueSerializer(code: string): Serializer | null;
export function getValueSerializer(code: DataType | string): Serializer | null {
    switch (code) {
    case "s":
    case "o":
        return StringSerializer.instance;

    case "g":
        return signatureSerializer;

    case "v":
        // TODO
    }

    const candidate = PrimitiveSerializer.instances[code];
    if (candidate)
        return candidate;
    
    return null;
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

    for (let index = 0; index < signature.length; ++index) {
        const token = signature[index];

        switch (token) {
        case CompositeKind.Array:
        case CompositeKind.Dictionary:
        case CompositeKind.Struct:
            builder.beginComposite(token);
            continue;

        case "}":
            builder.endComposite(CompositeKind.Dictionary, signature);
            continue;

        case ")":
            builder.endComposite(CompositeKind.Struct, signature);
            continue;
        }

        const candidate = getValueSerializer(token);
        if (!candidate)
            throw new Error(`Unrecognized token "${token}" in DBus signature: ${signature}`);
    }

    return builder.build(signature);
}
