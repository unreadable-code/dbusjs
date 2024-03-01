import {XMLParser} from "fast-xml-parser";

import {DataType} from ".";
import {type Serializer, StructSerializer, parseSignature} from "./serialization";

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

function ensureArray<T>(value: T | T[] | null): T[] {
    if (!value)
        return [];

    return Array.isArray(value) ? value : [value];
}

export class MethodSpecification {
    readonly name: string;
    readonly arguments: ReadonlyArray<ValueSpecification>;

    constructor(d: MethodDefinition) {
        this.name = d.name;
        this.arguments = mapValueSpecifications(ensureArray(d.arg), MethodSpecification.decorateArg);
    }

    private static decorateArg(v: ValueSpecification, e: MethodArgumentDefinition): void {
        if (e.direction === "out")
            v.read = true;
        else
            v.write = true;
    }

    private argumentsSerializer?: Serializer;
    getArgumentsSerializer(): Serializer {
        return this.argumentsSerializer
            || (this.argumentsSerializer = new StructSerializer(
                this.arguments.map(a => parseSignature(a.type)[0])));
    }
}

export class SignalSpecification {
    readonly name: string;
    readonly arguments: ReadonlyArray<ValueSpecification>;

    constructor(d: SignalDefinition) {
        this.name = d.name;
        this.arguments = mapValueSpecifications(ensureArray(d.arg), SignalSpecification.decorateArg);
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

function getByName<T extends {name: string}>(values: Iterable<T>, name: string): T | null {
    for (const candidate of values)
        if (candidate.name === name)
            return candidate;

    return null;
}

export class InterfaceSpecification {
    readonly methods: ReadonlyArray<MethodSpecification>;
    readonly signals: ReadonlyArray<SignalSpecification>;
    readonly properties: ReadonlyArray<ValueSpecification>;

    constructor(definition: InterfaceDefinition) {
        this.methods = ensureArray(definition.method).map(v => new MethodSpecification(v));
        this.signals = ensureArray(definition.signal).map(v => new SignalSpecification(v));
        this.properties = ensureArray(definition.property).map(mapProperty);
    }

    getMethod(name: string): MethodSpecification | null {
        return getByName(this.methods, name);
    }

    getSignal(name: string): SignalSpecification | null {
        return getByName(this.signals, name);
    }

    getProperty(name: string): ValueSpecification | null {
        return getByName(this.properties, name);
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
        const d = getByName(this.interfaces, name);
        return d && new InterfaceSpecification(d);
    }

    static parse(xml: string): IntrospectionResult {
        const doc = parser.parse(xml, false) as IntrospectionXML;
        return new IntrospectionResult(doc);
    }
}
