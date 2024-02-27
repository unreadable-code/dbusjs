import {XMLParser} from "fast-xml-parser";

import {DataType} from ".";

export interface ValueSpecification {
    name: string;
    type: DataType;

    // whether the value is read by the invoker
    read?: boolean;

    // whether the value is written by the invoker
    write?: boolean;
}

function mapValueSpecifications<T extends SignalArgumentDefinition>(
    elements: Iterable<T>,
    decorator: (v: ValueSpecification, attrs: T) => void,
): ValueSpecification[] {
    const result = [];

    for (const e of elements) {
        const v = e as ValueSpecification;
        decorator(v as ValueSpecification, e);
        result.push(v);
    }

    return result;
}

export class MethodSpecification {
    readonly arguments: ReadonlyArray<ValueSpecification>;

    constructor(d: MethodDefinition) {
        this.arguments = mapValueSpecifications(d.arg, MethodSpecification.decorateArg);
    }

    private static decorateArg(v: ValueSpecification, e: MethodArgumentDefinition): void {
        if (e.direction === "out")
            v.read = true;
        else
            v.write = true;
    }
}

export class SignalSpecification {
    readonly arguments: ReadonlyArray<ValueSpecification>;

    constructor(d: SignalDefinition) {
        this.arguments = mapValueSpecifications(d.arg, SignalSpecification.decorateArg);
    }

    private static decorateArg(v: ValueSpecification): void {
        v.read = true;
    }
}

function mapProperty(d: PropertyDefinition): ValueSpecification {
    const v: ValueSpecification = {
        name: d.name,
        type: d.type as unknown as DataType,
    };

    switch (d.access) {
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

    constructor(definition: InterfaceDefinition) {
        this.methods = Array.isArray(definition.method)
            ? definition.method.map(v => new MethodSpecification(v))
            : [new MethodSpecification(definition.method)];

        this.signals = Array.isArray(definition.signal)
            ? definition.signal.map(v => new SignalSpecification(v))
            : [new MethodSpecification(definition.signal)];

        this.properties = Array.isArray(definition.property)
            ? definition.property.map(mapProperty)
            : [mapProperty(definition.property)];
    }
}

interface SignalArgumentDefinition {
    name: string;
    type: string;
}

interface PropertyDefinition extends SignalArgumentDefinition {
    access: "read" | "write" | "readwrite";
}

interface MethodArgumentDefinition extends SignalArgumentDefinition {
    direction: "in" | "out";
}

interface MethodDefinition {
    name: string;
    arg: MethodArgumentDefinition[];
}

interface SignalDefinition {
    name: string;
    arg: SignalArgumentDefinition[];
}

interface InterfaceDefinition {
    name: string;
    method: MethodDefinition[];
    signal: SignalDefinition[];
    property: PropertyDefinition[];
}

interface NodeDefinition {
    interface: InterfaceDefinition[];
}

interface IntrospectionXML {
    node: NodeDefinition;
}

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
});

export class IntrospectionResult {
    readonly interfaces: InterfaceDefinition[];

    private constructor(document: IntrospectionXML) {
        this.interfaces = document.node.interface;
    }

    getInterface(name: string): InterfaceSpecification | null {
        for (const i of this.interfaces)
            if (i.name === name)
                return new InterfaceSpecification(i);

        return null;
    }

    static parse(xml: string): IntrospectionResult {
        const doc = parser.parse(xml, false) as IntrospectionXML;
        return new IntrospectionResult(doc);
    }
}
