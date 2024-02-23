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

    pad(length: number): void {
        length -= this.offset % length;
        new Uint8Array(this.view.buffer, this.offset, length);
        this.offset += length;
    }

    writeString(value: string): void {
        this.pad(4);
        this.view.setInt32(this.offset, value.length, true);
        const allocated = value.length;
        const strview = new Uint8Array(this.view.buffer, this.offset, allocated);
        const progress = new TextEncoder().encodeInto(value, strview);
        if (progress.read < value.length) {
            // TODO: handle resizing
        }
        this.offset += 5 + allocated;
        this.view.setUint8(this.offset - 1, 0);
    }

    writeSignature(value: string): void {
        this.view.setUint8(this.offset, value.length);
        const allocated = value.length;
        const strview = new Uint8Array(this.view.buffer, this.offset, allocated);
        const progress = new TextEncoder().encodeInto(value, strview);
        if (progress.read < value.length) {
            // TODO: handle resizing
        }
        this.offset += 2 + allocated;
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
}

type Value = number | string | boolean | bigint | ReadonlyArray<Value>;

interface Serializer {
    estimateBytesLength(value: Value): number;
    serializeInto(writer: Writer, value: Value): void;
}

interface WriterMethodErasure {
    (value: Value): void;
}

type PrimitiveTypeCode = "ybnqiuxtd"; // TODO: h
// type VariableTypeCode = "sogv";
// type ReservedTypeCode = "rem*?@&^";

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

    static instances: {[K in PrimitiveTypeCode[number]]: PrimitiveSerializer} = {
        "y": new PrimitiveSerializer(1, Writer.prototype.writeByte),
        "b": new PrimitiveSerializer(4, Writer.prototype.writeBool),
        "n": new PrimitiveSerializer(2, Writer.prototype.writeInt16),
        "q": new PrimitiveSerializer(2, Writer.prototype.writeUInt16),
        "i": new PrimitiveSerializer(4, Writer.prototype.writeInt32),
        "u": new PrimitiveSerializer(4, Writer.prototype.writeUInt32),
        "x": new PrimitiveSerializer(8, Writer.prototype.writeInt64),
        "t": new PrimitiveSerializer(8, Writer.prototype.writeUInt64),
        "d": new PrimitiveSerializer(8, Writer.prototype.writeDouble),
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

    serialize(values: ReadonlyArray<Value>, padding?: number): Uint8Array {
        const size = this.estimateBytesLength(values);
        const buffer = new ArrayBuffer(size + (padding || 64));
        const writer = new Writer(buffer);
        this.serializeInto(writer, values);
        return new Uint8Array(buffer);
    }
}

export class ArraySerializer extends StructSerializer {
    estimateBytesLength(value: Value): number {
        const values = value as ReadonlyArray<Value>;

        let result = 0;
        for (let n = 0; n < values.length; ++n)
            result += super.estimateBytesLength(values[n]);

        return result;
    }

    serializeInto(writer: Writer, value: Value): void {
        const values = value as ReadonlyArray<Value>;

        for (let n = 0; n < values.length; ++n)
            super.serializeInto(writer, values[n]);
    }
}

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

        case "s":
            // TODO
            break;

        case "o":
            // TODO
            break;

        case "g":
            // TODO
            break;

        default:
            if (!builder.addPrimitive(token))
                throw new Error(`Unrecognized token "${token}" in DBus signature: ${signature}`);
        }

        ++index;
    }

    return builder.build(signature);
}
