export enum DataType {
    String = "s",
    Boolean = "b",
    ObjectPath = "o",
    Variant = "v",

    Byte = "y",

    Unsigned16 = "q",
    Unsigned32 = "u",
    Unsigned64 = "t",

    Int16 = "n",
    Int32 = "i",
    Int64 = "x",

    TypeSignature = "g",
    Double = "d",
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
        this.offset = size * Math.trunc((this.offset + size - 1) / size);
        return this.offset;
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
    readonly signature: string;

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
        readonly signature: string,
        bytes: number,
        method: typeof Writer.prototype[keyof typeof Writer.prototype],
    ) {
        this.alignment = bytes;
        this.method = method as WriterMethodErasure;
    }

    estimateBytesLength(): number {
        return this.alignment * 2 - 1;
    }

    serializeInto(writer: Writer, value: Value): void {
        this.method.call(writer, value);
    }

    static instances: {[K in DataType[number]]: PrimitiveSerializer} = {
        [DataType.Byte]: new PrimitiveSerializer(DataType.Byte, 1, Writer.prototype.writeByte),
        [DataType.Boolean]: new PrimitiveSerializer(DataType.Boolean, 4, Writer.prototype.writeBool),
        [DataType.Int16]: new PrimitiveSerializer(DataType.Int16, 2, Writer.prototype.writeInt16),
        [DataType.Int32]: new PrimitiveSerializer(DataType.Int32, 4, Writer.prototype.writeInt32),
        [DataType.Int64]: new PrimitiveSerializer(DataType.Int64, 8, Writer.prototype.writeInt64),
        [DataType.Unsigned16]: new PrimitiveSerializer(DataType.Unsigned16, 2, Writer.prototype.writeUInt16),
        [DataType.Unsigned32]: new PrimitiveSerializer(DataType.Unsigned32, 4, Writer.prototype.writeUInt32),
        [DataType.Unsigned64]: new PrimitiveSerializer(DataType.Unsigned64, 8, Writer.prototype.writeUInt64),
        [DataType.Double]: new PrimitiveSerializer(DataType.Double, 8, Writer.prototype.writeDouble),
        // TODO: "h": new PrimitiveSerializer(4, Writer.prototype.writeUInt32),
    };
}

export class StructSerializer implements Serializer {
    alignment!: number;
    signature: string;

    constructor(private readonly fields: Serializer[]) {
        this.signature = `(${fields.map(f => f.signature).join("")})`;
    }

    estimateBytesLength(value: Value): number {
        const values = value as ReadonlyArray<Value>;

        let result = 7;
        for (let n = 0; n < this.fields.length; ++n)
            result += this.fields[n].estimateBytesLength(values[n]);

        return result;
    }

    serializeInto(writer: Writer, value: Value): void {
        writer.pad(8);

        const values = value as ReadonlyArray<Value>;
        for (let n = 0; n < this.fields.length; ++n)
            this.fields[n].serializeInto(writer, values[n]);
    }
}

StructSerializer.prototype.alignment = 8;

class ArraySerializer implements Serializer {
    alignment!: number;
    signature: string;

    constructor(private readonly element: Serializer) {
        this.signature = `a${element.signature}`;
    }

    estimateBytesLength(value: Value): number {
        const values = value as ReadonlyArray<Value>;

        let result = 4 * 2 - 1;
        for (let n = 0; n < values.length; ++n)
            result += this.element.estimateBytesLength(values[n]);

        return result;
    }

    serializeInto(writer: Writer, value: Value): void {
        const values = value as ReadonlyArray<Value>;

        const sizeFieldPosition = writer.pad(4);
        writer.seek(sizeFieldPosition + 4);

        // dbus specification says even 0 length arrays include element padding
        // and that its size field don't include said padding
        const elementsPosition = writer.pad(this.element.alignment);

        const count = values.length;
        for (let n = 0; n < count; ++n)
            this.element.serializeInto(writer, values[n]);

        const endPosition = writer.position;
        writer.view.setUint32(sizeFieldPosition, endPosition - elementsPosition, true);
    }
}

ArraySerializer.prototype.alignment = 4;

class StringSerializer implements Serializer {
    alignment!: number;

    constructor(readonly signature: string) {
        // do nothing
    }

    estimateBytesLength(value: Value): number {
        return 1 + (4 * 2 - 1) + (value as string).length;
    }

    serializeInto(writer: Writer, value: Value): void {
        writer.writeString(value as string)
    }
}

StringSerializer.prototype.alignment = 4;

class SignatureSerializer implements Serializer {
    alignment!: number;
    signature!: string;

    estimateBytesLength(value: Value): number {
        return 2 + (value as string).length;
    }

    serializeInto(writer: Writer, value: Value): void {
        writer.writeSignature(value as string)
    }
}

SignatureSerializer.prototype.alignment = 1;
SignatureSerializer.prototype.signature = DataType.TypeSignature;

export const stringSerializer: Serializer = new StringSerializer(DataType.String);
export const pathSerializer: Serializer = new StringSerializer(DataType.ObjectPath);
export const signatureSerializer: Serializer = new SignatureSerializer();
export const emptySerializer: Serializer = new StructSerializer([]);

/**
 * Get a serializer for a non-composite value
 */
export function getValueSerializer(code: DataType): Serializer;
export function getValueSerializer(code: string): Serializer | null;
export function getValueSerializer(code: DataType | string): Serializer | null {
    switch (code) {
    case "s":
        return stringSerializer;

    case "o":
        return pathSerializer;

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

const enum CompositeKind {
    Array = "a",
    Struct = "(",
    Dictionary = "{",
}

interface CompositeSerializerParts {
    readonly kind?: CompositeKind;
    readonly elements: Serializer[];
}

class SerializerBuilder {
    private readonly incomplete: CompositeSerializerParts[];
    private current: CompositeSerializerParts;

    constructor() {
        this.current = { elements: [] };
        this.incomplete = [];
    }

    add(serializer: Serializer): void {
        while (this.current.kind === CompositeKind.Array) {
            serializer = new ArraySerializer(serializer);
            this.current = this.incomplete.pop()!;
        }

        this.current.elements.push(serializer);
    }

    beginComposite(kind: CompositeKind): void {
        this.incomplete.push(this.current);
        this.current = { kind, elements: [] };
    }

    endComposite(kind: CompositeKind, signature: string): void {
        if (this.current.kind !== kind)
            throw new Error(`Composite type mismatch in DBus signature: ${signature}`);

        const {elements} = this.current;
        if (elements.length < 1)
            throw new Error(`Empty composite type in dbus signature: ${signature}`);

        this.current = this.incomplete.pop()!;

        switch (kind) {
        case CompositeKind.Dictionary:
            // TODO
            break;

        case CompositeKind.Struct:
            this.add(new StructSerializer(elements));
            break;
        }
    }

    build(signature: string): Serializer[] {
        if (this.incomplete.length > 1)
            throw new Error(`Incomplete DBus signature: ${signature}`);

        return this.current.elements;
    }
}

// type ReservedTypeCode = "rem*?@&^";

export function parseSignature(signature: string): Serializer[] {
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
        if (candidate)
            builder.add(candidate);
        else
            throw new Error(`Unrecognized token "${token}" in DBus signature: ${signature}`);

    }

    return builder.build(signature);
}
