import { Store } from 'redux';
import * as React from 'react';
import * as PropTypes from 'prop-types';

type Target = { [key: string]: Target; [key: number]: Target };
type ArrayTarget = Target[] & { [key: string]: any; };
type Index = { [key: string]: any };

class AtomValue {
    _attached = true;

    constructor(public _target: {}) {}
}

let id = 1;
let arrayVersion = 0;
let inTransaction = false;
let inInitializing = false;
let initWithState = false;
let usingProxies: (AtomProxy | AtomValue)[] | undefined = void 0;


interface CustomStore extends Store<{}> {
    atomStore: RootStore;
}

interface ActionCreator {
    (payload: {}): void;

    reducer: (payload: {}) => void;
}

export class AtomProxy {
    /* prototype fields */
    _path: string = '';
    _fields: string[];
    _excludedMethods: string[];
    _factoryClasses: (typeof AtomProxy | typeof AtomProxy[] | undefined)[];


    constructor(rootStore?: RootStore, target?: Target, parent?: AtomProxy, key?: string | number) {
        this._rootStore = rootStore;
        this._parent = parent;
        this._target = target === void 0 ? {} : target;
        this._values = Array(this._fields.length);
        if (rootStore !== void 0) {
            rootStore._makePathAndAddToStorage(this, key!);
        }
    }

    init() {}

    _id = id++;
    _parent: AtomProxy | undefined = void 0;
    _target: Target = {};
    _rootStore: RootStore | undefined = void 0;
    //
    // _getRootStore() {
    //     let rootStore: RootStore | void 0 = this.__rootStore;
    //     if (rootStore === void 0) {
    //         let parent = this._parent;
    //         while (parent !== void 0 && rootStore === void 0) {
    //             rootStore = parent.__rootStore;
    //         }
    //         this.__rootStore = rootStore;
    //     }
    //     return rootStore;
    // }

    // _keyIdx: number;
    _key: string | number = '';
    _attached = true;
    _values: (AtomProxy | AtomValue | undefined)[];

    cloneTarget(): Target {
        return {};
    }
}

AtomProxy.prototype._fields = [];

function buildAtomProxy(rootStore: RootStore | undefined, parent: AtomProxy, keyIdx: number, key: string | number, target: Target) {
    target = getRawValueIfExists(target);
    const CustomFactory = parent._factoryClasses[keyIdx];
    if (CustomFactory === void 0) {
        return new AtomValue(target);
        // throw new Error('Do not specified the entity factory');
    }
    const prevInInitializing = inInitializing;
    const prevInTransaction = inTransaction;
    inInitializing = true;
    inTransaction = true;
    try {
        let proxy;
        if (CustomFactory instanceof Array) {
            const childFactory = CustomFactory[0];
            proxy = new ArrayProxy(rootStore, target as ArrayTarget, parent, key, childFactory);
        } else {
            proxy = new CustomFactory(rootStore, target, parent, key);
        }
        if (!initWithState) {
            proxy.init();
        }
        return proxy;
    } finally {
        inInitializing = prevInInitializing;
        inTransaction = prevInTransaction;
    }
}


interface Action {
    type: string;
    path?: string;
    payload?: {};
}

export class RootStore extends AtomProxy {
    reducers = new Map<string, (payload: {}) => void>();
    reduxStore: CustomStore;
    instanceMap = new Map<string, AtomProxy>();
    _factoryClasses: typeof AtomProxy[] = [];
    _factoryMap = new Map<string, number>();
    stores: typeof BaseStore[];
    _fields: string[] = [];
    _values: (AtomProxy | AtomValue | undefined)[] = [];
    _path = 'root';

    setReduxStore(store: Store<{}>) {
        this.reduxStore = store as CustomStore;
        this.reduxStore.atomStore = this;
        store.subscribe(() => {
            if (this._target !== store.getState()) {
                for (let i = 0; i < this._values.length; i++) {
                    detach(this._values[i]);
                    this._values[i] = void 0;
                }
                this._target = store.getState();
                initWithState = true;
                try {
                    this._initialize(this);
                } finally {
                    initWithState = false;
                }
            }
        });
    }

    _initialize(root: AtomProxy) {
        for (let i = 0; i < root._values.length; i++) {
            //init
            getValue(root, i, root._fields[i]);
            if (root._values[i] instanceof AtomProxy) {
                this._initialize(root._values[i] as AtomProxy);
            }
        }
    }

    _makePathAndAddToStorage(proxy: AtomProxy | AtomValue | undefined, key: string | number) {
        if (proxy instanceof AtomProxy && proxy._parent !== void 0) {
            proxy._key = key;
            proxy._path = proxy._parent._path + '.' + proxy._key;
            this.instanceMap.set(proxy._path, proxy);
            for (let i = 0; i < proxy._values.length; i++) {
                this._makePathAndAddToStorage(proxy._values[i], proxy._fields[i]);
            }
        }
    }


    mainReducer = (state: {}, action: Action): {} => {
        const reducer = this.reducers.get(action.type);
        if (reducer !== void 0) {
            const instance = this.instanceMap.get(action.path!);
            if (instance !== void 0) {
                const prevInTransaction = inTransaction;
                inTransaction = true;
                try {
                    reducer.call(instance, this._convertPayloadPlainObjectToNormal(action.payload));
                    return this._target;
                } finally {
                    inTransaction = prevInTransaction;
                }
            } else {
                throw new Error('You try to use a detached object from the state tree');
            }
        } else if (action.type === '@@INIT') {
            initWithState = state !== void 0;
            this.replaceState(state);
            try {
                this._initialize(this);
            } finally {
                initWithState = false;
            }
        }
        return this._target;
    };

    replaceState(target: Target) {
        this._target = target === void 0 ? {} : target;
        for (let i = 0; i < this._values.length; i++) {
            detach(this._values[i]);
            this._values[i] = void 0;
        }
    }

    dispatch(type: string, thisArg: AtomProxy, payload: {}) {
        payload = this._convertPayloadToPlainObject(payload);
        const action: Action = { type: type, path: thisArg._path, payload };
        this.reduxStore.dispatch(action);
    }

    _convertPayloadToPlainObject(payload: Index) {
        if (typeof payload === 'object' && payload !== null) {
            if (payload instanceof AtomProxy) {
                return { _path: payload._path };
            }
            const keys = Object.keys(payload);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const val = payload[key];
                const newVal = this._convertPayloadToPlainObject(val);
                if (val !== newVal) {
                    payload[key] = newVal;
                }
            }
        }
        return payload;
    }

    _convertPayloadPlainObjectToNormal(payload: Index | undefined) {
        if (typeof payload === 'object' && payload !== null) {
            if (payload._path) {
                return this.instanceMap.get(payload._path);
            }
            const keys = Object.keys(payload);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const val = payload[key];
                const newVal = this._convertPayloadPlainObjectToNormal(val);
                if (val !== newVal) {
                    payload[key] = newVal;
                }
            }
        }
        return payload;
    }

    constructor(stores: typeof BaseStore[]) {
        super(void 0, {});
        this.stores = stores;
        this._rootStore = this;
        this.stores.forEach((Store, i) => {
            this.registerReducersFromClass(Store);
            this._factoryMap.set(Store.name, i);
            this._factoryClasses.push(Store);
            this._fields.push(Store.name);
            this._values.push(void 0);
        });
    }

    // getMiddleware(): Middleware {
    //     return api => {
    //         console.log('middleware', api);
    //         return next => {
    //             return action => {
    //                 return next(action);
    //             };
    //         };
    //     };
    // }

    registerReducersFromClass(Ctor: typeof AtomProxy) {
        let proto = Ctor.prototype;
        const methods = Object.getOwnPropertyNames(proto);
        for (let i = 0; i < methods.length; i++) {
            const method = methods[i];
            if (proto._excludedMethods.indexOf(method) === -1 && method[0] !== '_' && method !== 'constructor' && method !== 'cloneTarget') {
                const descriptor = Object.getOwnPropertyDescriptor(proto, method)!;
                const reducer = descriptor.value;
                if (typeof reducer === 'function') {
                    this.reducers.set(Ctor.name + '.' + method, ((proto as Index)[method] as ActionCreator).reducer);
                }
            }
        }
        for (let i = 0; i < proto._factoryClasses.length; i++) {
            const SubCtor = proto._factoryClasses[i];
            if (SubCtor) {
                this.registerReducersFromClass(SubCtor instanceof Array ? SubCtor[0] : SubCtor);
            }
        }
    }
}


class ArrayProxy extends AtomProxy {
    _factoryClasses: (typeof AtomProxy | typeof AtomProxy[] | undefined)[] = [];

    _target: ArrayTarget;
    _version: AtomValue = undefined!;
    // _values = [];

    length: number = 0;

    constructor(rootStore?: RootStore, target?: ArrayTarget, parent?: AtomProxy, key?: string | number, childFactory?: (typeof AtomProxy | typeof AtomProxy[])) {
        super(rootStore, void 0, parent, key);
        this._factoryClasses.push(childFactory);
        if (target === void 0 || !(target instanceof Array)) {
            this._target = [];
        } else {
            this._target = target;
            this._values = this._makeArrayTargetsToProxy(this._target, 0);
        }
        this._updateVersion();
    }

    _commit(start: number, end: number) {
        const newTarget = new Array(this._values.length) as ArrayTarget;
        for (let i = 0; i < this._values.length; i++) {
            newTarget[i] = this._values[i]!._target;
        }
        Object.freeze(newTarget);
        if (this._parent !== void 0) {
            rebuildTarget(this._parent, this._key, newTarget);
        }
        this._target = newTarget;
        if (this._rootStore !== void 0) {
            for (let i = start; i < end; i++) {
                this._rootStore._makePathAndAddToStorage(this._values[i], i);
            }
        }
        this._updateVersion();
    }

    _updateVersion() {
        detach(this._version);
        this._version = new AtomValue(arrayVersion++);
        this.length = this._values.length;
    }

    _makeArrayTargetsToProxy(arr: (Target | undefined)[], idxStart: number) {
        let newArr: (AtomProxy | AtomValue)[] = new Array(arr.length);
        for (let i = 0; i < arr.length; i++) {
            newArr[i] = buildAtomProxy(this._rootStore, this, 0, idxStart + i, arr[i]!);
        }
        return newArr;
    }

    _checkToExit() {
        checkWeAreInTransaction();
        return inInitializing && initWithState;
    }


    push(...items: Target[]) {
        if (this._checkToExit()) return this._target.length;
        const ret = this._values.push(...this._makeArrayTargetsToProxy(items, this._values.length));
        this._commit(0, 0);
        return ret;
    }


    unshift(...items: Target[]) {
        if (this._checkToExit()) return this._target.length;
        const ret = this._values.unshift(...this._makeArrayTargetsToProxy(items, 0));
        this._commit(items.length, this._values.length);
        return ret;
    }

    pop(): Target | undefined {
        if (this._checkToExit()) return void 0;
        const ret = this._values.pop();
        detach(ret);
        this._commit(0, 0);
        return getProxyOrRawValue(ret);
    }

    shift(): Target | undefined {
        if (this._checkToExit()) return void 0;
        const ret = this._values.shift();
        detach(ret);
        this._commit(0, this._values.length);
        return getProxyOrRawValue(ret);
    }

    reverse() {
        if (this._checkToExit()) return this;
        this._values.reverse();
        this._commit(0, this._values.length);
        return this;
    }

    splice(start: number, deleteCount = 0, ...items: Target[]) {
        if (this._checkToExit()) return this;
        for (let i = start; i < start + deleteCount; i++) {
            detach(this._values[i]);
        }
        const ret = this._values.splice(start, deleteCount, ...this._makeArrayTargetsToProxy(items, start));
        this._commit(start, this._values.length);
        return ret;
    }

    sort(compareFn: (a: Target | undefined, b: Target | undefined) => number = () => 1) {
        if (this._checkToExit()) return this;
        this._values.sort((a, b) => compareFn(getProxyOrRawValue(a), getProxyOrRawValue(b)));
        this._commit(0, this._values.length);
        return this;
    }

    cloneTarget(): Target {
        return this._target.slice() as ArrayTarget;
    }
}

// ArrayProxy.prototype._excludedMethods = [];
// ArrayProxy.prototype._fields = [];

const immutableMethods = ['toString', 'toLocaleString', 'concat', 'join', 'slice', 'indexOf', 'lastIndexOf', 'every', 'some', 'forEach', 'map', 'filter', 'reduce', 'reduceRight'];
for (let i = 0; i < immutableMethods.length; i++) {
    const method = immutableMethods[i];
    const fn = (Array.prototype as Index)[method];
    (ArrayProxy.prototype as Index)[method] = function (this: ArrayProxy) {
        putProxyToUsing(this._version);
        const a = new Array(this._values.length);
        for (let i = 0; i < this._values.length; i++) {
            a[i] = getProxyOrRawValue(this._values[i]);
        }
        return fn.apply(a, arguments);
    };
}

export class BaseStore extends AtomProxy {
}


function checkWeAreInTransaction() {
    if (!inTransaction) {
        throw new Error('You cannot update the state outside of a reducer method');
    }
}

function rebuildTarget(proxy: AtomProxy, key: string | number, value: Target) {
    value = getRawValueIfExists(value);

    let clone = proxy.cloneTarget();
    clone[key] = value;
    Object.freeze(clone);
    proxy._target = clone;
    if (proxy._parent !== void 0) {
        rebuildTarget(proxy._parent, proxy._key, clone);
    }
}

function detach(proxy: AtomProxy | AtomValue | undefined) {
    if (proxy instanceof AtomProxy) {
        proxy._attached = false;
        // if (proxy._parent !== void 0) {
        // proxy._parent._values[proxy._keyIdx] = undefined!;
        // }
        proxy._parent = void 0;
        if (proxy._rootStore !== void 0) {
            proxy._rootStore.instanceMap.delete(proxy._path);
        }
        proxy._rootStore = void 0;
        if (proxy._values !== void 0) {
            for (let i = 0; i < proxy._values.length; i++) {
                detach(proxy._values[i]);
                proxy._values[i] = undefined;
            }
        }
    } else if (proxy instanceof AtomValue) {
        proxy._attached = false;
    }
}


function putProxyToUsing(proxy: AtomValue | AtomValue) {
    if (usingProxies !== void 0) {
        if (usingProxies.indexOf(proxy) === -1) {
            usingProxies.push(proxy);
        }
    }
}

function getValue(proxy: AtomProxy, keyIdx: number, key: string) {
    if (!proxy._attached) {
        //todo:
    }
    let childProxy = proxy._values[keyIdx];
    if (childProxy === void 0) {
        childProxy = buildAtomProxy(proxy._rootStore, proxy, keyIdx, key, proxy._target[key]);
        proxy._values[keyIdx] = childProxy;
    }
    if (proxy._attached) {
        putProxyToUsing(childProxy);
    }
    return getProxyOrRawValue(childProxy);
}

function getProxyOrRawValue(proxy: AtomProxy | AtomValue | undefined) {
    if (proxy instanceof AtomValue) {
        return proxy._target;
    }
    return proxy;
}

function getRawValueIfExists(value: AtomProxy | AtomValue | Target): Target {
    if (value instanceof AtomProxy || value instanceof AtomValue) {
        return value._target;
    }
    return value;
}

function setValue(proxy: AtomProxy, keyIdx: number, key: string, value: Target) {
    checkWeAreInTransaction();
    if (inInitializing && initWithState) {
        return;
    }
    if (!proxy._attached) {
        //todo:
    }

    rebuildTarget(proxy, key, value);
    detach(proxy._values[keyIdx]);
    proxy._values[keyIdx] = buildAtomProxy(proxy._rootStore, proxy, keyIdx, key, value);
}

function actionCreatorFactory(type: string, reducer: () => void) {
    const actionCreator = function (this: AtomProxy, payload: {}) {
        if (inTransaction) {
            reducer.call(this, payload);
        } else {
            if (this._rootStore !== void 0) {
                this._rootStore.dispatch(type, this, payload);
            } else {
                throw new Error('This object is not in the store tree');
            }
        }
    } as ActionCreator;
    actionCreator.reducer = reducer;
    return actionCreator;
}

export function prepareEntity<T>(Ctor: typeof AtomProxy & { new (): T }, fields: (keyof T)[], excludedMethods: (keyof T)[], factories: { [key: string]: (typeof AtomProxy | typeof AtomProxy[]) }) {
    const methods = Object.getOwnPropertyNames(Ctor.prototype);
    for (let i = 0; i < methods.length; i++) {
        const methodName = methods[i];
        if ((excludedMethods as string[]).indexOf(methodName) === -1 && methodName !== 'constructor') {
            const descriptor = Object.getOwnPropertyDescriptor(Ctor.prototype, methodName)!;
            if (typeof descriptor.value === 'function') {
                (Ctor.prototype as Index)[methodName] = actionCreatorFactory(Ctor.name + '.' + methodName, descriptor.value);
            }
        }
    }
    const factoriesItems = new Array(fields.length);
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (factories[field]) {
            factoriesItems[i] = factories[field];
        }
        Object.defineProperty(Ctor.prototype, field, {
            get: function (this: AtomProxy) {
                return getValue(this, i, field);
            },
            set: function (this: AtomProxy, value: Target) {
                setValue(this, i, field, value);
            }
        });
    }
    Ctor.prototype._fields = fields;
    Ctor.prototype._excludedMethods = excludedMethods;
    Ctor.prototype._factoryClasses = factoriesItems;
    Ctor.prototype.cloneTarget = function (this: AtomProxy) {
        let copy: Target = {};
        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            copy[field] = this._target[field];
        }
        return copy;
    };
}


export function component<Store extends BaseStore>(StoreCtor: { new(): Store }) {
    return <Props>(cmp: (props: Props & { children?: React.ReactNode }, store: Store) => React.ReactNode) => {
        return class extends React.Component<Props> {
            static displayName = cmp.name;
            static contextTypes = { store: PropTypes.object };
            context: { store: CustomStore };
            listenedProps: (AtomProxy | AtomValue)[] = [];

            shouldComponentUpdate(nextProps: this['props'], nextState: this['state'], nextContext: this['context']) {
                if (nextProps !== this.props) {
                    const keys = Object.keys(this.props);
                    for (let i = 0; i < keys.length; i++) {
                        const key = keys[i];
                        if ((nextProps as Index)[key] !== (this.props as Index)[key]) {
                            return true;
                        }
                    }
                }
                for (let i = 0; i < this.listenedProps.length; i++) {
                    const prop = this.listenedProps[i];
                    if (!prop._attached) {
                        return true;
                    }
                }
                return false;
            }

            unsubscribe: () => void = undefined!;
            isMount = true;

            componentWillMount() {
                this.unsubscribe = this.context.store.subscribe(() => {
                    setTimeout(() => {
                        if (this.isMount) {
                            this.setState({ x: Math.random() });
                        }
                    });
                });
            }

            componentWillUnmount() {
                this.unsubscribe();
                this.isMount = false;
            }

            render() {
                const { store } = this.context;
                usingProxies = [];
                try {
                    const storeKeyIdx = store.atomStore._factoryMap.get(StoreCtor.name);
                    if (storeKeyIdx === void 0) {
                        throw new Error('Store "' + StoreCtor.name + '" is not registered in the RootStore instance');
                    }
                    const ret = cmp(this.props, getValue(store.atomStore, storeKeyIdx, StoreCtor.name) as Store);
                    this.listenedProps = usingProxies;
                    return ret;
                } finally {
                    usingProxies = void 0;
                }
            }
        };

    };
}
