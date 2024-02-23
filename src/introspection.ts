import {DataType, XMLError} from ".";

export interface ValueSpecification {
    name: string;
    type: DataType;

    // whether the value is read by the invoker
    read?: boolean;

    // whether the value is written by the invoker
    write?: boolean;
}

function mapValueSpecifications(
    elements: Iterable<Node>,
    nodeName: string,
    decorator: (v: ValueSpecification, attrs: Element) => void,
): ValueSpecification[] {
    const result = [];

    for (const e of elements) {
        if (isElement(e) && e.nodeName === "arg") {
            const v: ValueSpecification = {
                name: e.getAttribute("name")!,
                type: e.getAttribute("type") as unknown as DataType,
            };

            decorator(v, e);
            result.push(v);
        }
    }

    return result;
}

function isElement(node: Node): node is Element {
    return node.nodeType === Node.ELEMENT_NODE;
}

export class MethodSpecification {
    readonly arguments: ReadonlyArray<ValueSpecification>;

    constructor(e: Element) {
        this.arguments = mapValueSpecifications(e.childNodes, "arg", MethodSpecification.decorateArg);
    }

    private static decorateArg(v: ValueSpecification, e: Element): void {
        if (e.getAttribute("direction") === "out")
            v.read = true;
        else
            v.write = true;
    }
}

export class SignalSpecification {
    readonly arguments: ReadonlyArray<ValueSpecification>;

    constructor(e: Element) {
        this.arguments = mapValueSpecifications(e.childNodes, "arg", SignalSpecification.decorateArg);
    }

    private static decorateArg(v: ValueSpecification): void {
        v.read = true;
    }
}

function mapProperty(e: Element): ValueSpecification {
    const v: ValueSpecification = {
        name: e.getAttribute("name")!,
        type: e.getAttribute("type") as unknown as DataType,
    };

    switch (e.getAttribute("access")) {
    case "read":
        v.read = true;
        break;

    case "write":
        v.write = true;
        break;

    case "readwrite":
        v.read = v.write = true;
        break;
    }

    return v;
}

export class InterfaceSpecification {
    readonly methods: ReadonlyArray<MethodSpecification>;
    readonly signals: ReadonlyArray<SignalSpecification>;
    readonly properties: ReadonlyArray<ValueSpecification>;

    constructor(specification: Element) {
        const methods = [];
        const signals = [];
        const properties = [];

        for (const child of specification.children) {
            if (!isElement(child))
                continue;

            switch (child.nodeName) {
            case "method":
                methods.push(new MethodSpecification(child));
                break;

            case "signal":
                signals.push(new SignalSpecification(child));
                break;

            case "property":
                properties.push(mapProperty(child));
                break;
            }
        }

        this.methods = methods;
        this.signals = signals;
        this.properties = properties;
    }
}

export class NodeSpecification {
    constructor(specification: Element) {
        // do nothing
    }
}

export class IntrospectionResult {
    private constructor(private readonly document: Document) {
        // do nothing
    }

    getInterface(name: string): InterfaceSpecification | null {
        const element = this.document.querySelector(`interface[name="${name}"]`);
        return element && new InterfaceSpecification(element);
    }

    getNode(name: string): NodeSpecification | null {
        const element = this.document.querySelector(`node[name="${name}"]`);
        return element && new NodeSpecification(element);
    }

    private static readonly parser = new DOMParser();

    static parse(xml: string): IntrospectionResult {
        const doc = this.parser.parseFromString(xml, "text/xml");

        const root = doc.firstElementChild;
        if (!root || root.nodeName === "parsererror")
            throw new XMLError(doc, "Unable to parse interface semantics");

        return new IntrospectionResult(doc);
    }
}
