export const enum DataType {
    String = "s",
    Boolean = "b",
    ObjectPath = "o",
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

export class XMLError extends Error {
    constructor(readonly document: XMLDocument, message: string) {
        super(message);
    }
}

export enum MessageType {
    Invalid = 0,
    MethodCall,
    MethodReturn,
    Error,
    Signal,
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

export {
    type InterfaceSpecification,
    type IntrospectionResult,
    type MethodSpecification,
    type SignalSpecification,
    type ValueSpecification,
} from "./introspection";

export {
    SerializationError,
    parseSignature,
} from "./serialization";

export {
    type Address,
    type AuthMethod,
    type UnixDomainAbstractAddress,
    type UnixDomainPathAddress,
    type UnixDomainSocketAddress,
    parseAddress,
} from "./transport";
