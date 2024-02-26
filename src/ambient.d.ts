interface ArrayBufferConstructor {
    new(length: number, options?: {maxByteLength: number}): ArrayBuffer;
}

interface ArrayBuffer {
    resize(size: number): void;
}
