export const enum DataType {
    integer = "i",
    string = "s",
    boolean = "b",
    // TODO
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
