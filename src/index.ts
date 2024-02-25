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
    DataType,
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
    sessionBus,
} from "./transport";
