export const enum DataType {
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

export class XMLError extends Error {
    constructor(readonly document: XMLDocument, message: string) {
        super(message);
    }
}

export {
    type InterfaceSpecification,
    type IntrospectionResult,
    type MethodSpecification,
    type SignalSpecification,
    type ValueSpecification,
} from "./introspection";

export {
    Builder as MessageBuilder,
    type Headers,
    Kind,
} from "./message";

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
