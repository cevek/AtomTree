import { Store } from 'redux';
import * as React from 'react';
import * as PropTypes from 'prop-types';

type Target = { [key: string]: Target; [key: number]: Target };
type ArrayTarget = Target[] & { [key: string]: Target; };
type Index = { [key: string]: any };

class AtomValue {
    _attached = true;

    constructor(public _target: {}) {}
}

let id = 1;
let arrayVersion = 0;
let inTransation = false;
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
    _fields: string[];
    _excludedMethods: string[];
    _factoryClasses: (typeof AtomProxy | typeof AtomProxy[] | undefined)[];


    constructor(rootStore?: RootStore) {
        this._rootStore = rootStore;
        if (rootStore !== void 0) {
            rootStore.instanceMap.set(this._id, this);
        }
    }


    _setTarget(target: Target) {
        if (!(target instanceof Object)) {
            target = {};
        }
        this._target = target;
        //this._values = new Array(this._fields.length);
    }


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
    _values: (AtomProxy | AtomValue | undefined)[] = new Array(this._fields.length);


    cloneTarget(): Target {
        return {};
    }
}

AtomProxy.prototype._fields = [];

function buildAtomProxy(rootStore: RootStore | undefined, parent: AtomProxy, keyIdx: number, key: string | number, value: Target) {
    value = getRawValueIfExists(value);
    const CustomFactory = parent._factoryClasses[keyIdx];
    if (CustomFactory === void 0) {
        return new AtomValue(value);
        // throw new Error('Do not specified the entity factory');
    }
    const proxy = CustomFactory instanceof Array ? new ArrayProxy(rootStore) : new CustomFactory(rootStore);
    proxy._parent = parent;
    proxy._key = key;
    proxy._setTarget(value);
    if (CustomFactory instanceof Array) {
        proxy._factoryClasses.push(CustomFactory[0]);
    }
    if (rootStore !== void 0) {
        rootStore.instanceMap.set(proxy._id, proxy);
    }
    return proxy;
}


interface Action {
    type: string;
    id?: number;
    payload?: {};
}

export class RootStore extends AtomProxy {
    reducers = new Map<string, (payload: {}) => void>();
    reduxStore: CustomStore;
    instanceMap = new Map<number, AtomProxy>();
    _factoryClasses: typeof AtomProxy[] = [];
    _factoryMap = new Map<string, number>();

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
            }
        });
    }

    mainReducer = (state: {}, action: Action) => {
        const reducer = this.reducers.get(action.type);
        if (reducer !== void 0) {
            const instance = this.instanceMap.get(action.id!);
            if (instance !== void 0) {
                reducer.call(instance, action.payload);
                return this._target;
            } else {
                throw new Error('You try to use a detached object from the state tree');
            }
        }
        return state;
    };

    dispatch(type: string, thisArg: AtomProxy, payload: {}) {
        this.reduxStore.dispatch({ type: type, id: thisArg._id, payload });
    }


    constructor(stores: typeof BaseStore[]) {
        super();
        this._rootStore = this;
        stores.forEach((Store, i) => {
            this.registerReducersFromClass(Store);
            // const store = new Store(this);
            // this.instanceMap.set(store._id, store);
            this._factoryMap.set(Store.name, i);
            this._factoryClasses.push(Store);
            setValue(this, i, Store.name, {});
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
    _version = new AtomValue(arrayVersion++);
    // _values = [];

    length: number;


    _commit() {
        const newTarget = new Array(this._values.length) as ArrayTarget;
        for (let i = 0; i < this._values.length; i++) {
            newTarget[i] = this._values[i]!._target;
        }
        Object.freeze(newTarget);
        if (this._parent !== void 0) {
            rebuildTarget(this._parent, this._key, newTarget);
        }
        this._updateVersion();
    }

    _updateVersion() {
        detach(this._version);
        this._version = new AtomValue(arrayVersion++);
        this.length = this._values.length;
    }

    _makeArrayTargetsToProxy(arr: (Target | undefined)[]) {
        let newArr: (AtomProxy | AtomValue)[] = new Array(arr.length);
        for (let i = 0; i < arr.length; i++) {
            newArr[i] = buildAtomProxy(this._rootStore!, this, 0, i, arr[i]!);
        }
        return newArr;
    }


    _setTarget(target: Target) {
        if (!(target instanceof Array)) {
            target = [] as any;
        }
        this._target = target as ArrayTarget;
        this._values = this._makeArrayTargetsToProxy(target as ArrayTarget);
        this._updateVersion();
    }

    push(...items: Target[]) {
        checkWeAreInTransaction();
        const ret = this._values.push(...this._makeArrayTargetsToProxy(items));
        this._commit();
        return ret;
    }


    unshift(...items: Target[]) {
        checkWeAreInTransaction();
        const ret = this._values.unshift(...this._makeArrayTargetsToProxy(items));
        this._commit();
        return ret;
    }

    pop(): Target | undefined {
        checkWeAreInTransaction();
        const ret = this._values.pop();
        detach(ret);
        this._commit();
        return getProxyOrRawValue(ret);
    }

    shift(): Target | undefined {
        checkWeAreInTransaction();
        const ret = this._values.shift();
        detach(ret);
        this._commit();
        return getProxyOrRawValue(ret);
    }

    reverse() {
        checkWeAreInTransaction();
        this._values.reverse();
        this._commit();
        return this;
    }

    splice(start: number, deleteCount: number, ...items: Target[]) {
        checkWeAreInTransaction();
        for (let i = start; i < deleteCount; i++) {
            detach(this._values[i]);
        }
        const ret = this._values.splice(start, deleteCount, ...this._makeArrayTargetsToProxy(items));
        this._commit();
        return ret;
    }

    sort(compareFn: (a: Target | undefined, b: Target | undefined) => number = () => 1) {
        checkWeAreInTransaction();
        this._values.sort((a, b) => compareFn(getProxyOrRawValue(a), getProxyOrRawValue(b)));
        this._commit();
        return this;
    }

    cloneTarget(): Target {
        return this._target.slice() as ArrayTarget;
    }
}

ArrayProxy.prototype._excludedMethods = [];
ArrayProxy.prototype._fields = [];

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
    if (!inTransation) {
        throw new Error('You cannot update the state outside of a reducer method');
    }
}

function startTransaction() {
    inTransation = true;
}

function commitTransaction() {
    inTransation = false;
}

function rollbackTransaction() {
    inTransation = false;
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
            proxy._rootStore.instanceMap.delete(proxy._id);
        }
        proxy._rootStore = void 0;
        for (let i = 0; i < proxy._values.length; i++) {
            detach(proxy._values[i]);
            proxy._values[i] = undefined;
        }
    }
    if (proxy instanceof AtomValue) {
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
    if (!proxy._attached) {
        //todo:
    }
    rebuildTarget(proxy, key, value);
    detach(proxy._values[keyIdx]);
    proxy._values[keyIdx] = buildAtomProxy(proxy._rootStore!, proxy, keyIdx, key, value);
}

function actionCreatorFactory(type: string, reducer: () => void) {
    const actionCreator = function (this: AtomProxy, payload: {}) {
        const alreadyInTransaction = inTransation;
        startTransaction();
        let error = true;
        try {
            if (!alreadyInTransaction) {
                if (this._rootStore !== void 0) {
                    this._rootStore.dispatch(type, this, payload);
                } else {
                    throw new Error('This object is not in the store tree');
                }
            } else {
                reducer.call(this, payload);
            }
            error = false;
            if (!alreadyInTransaction) {
                commitTransaction();
            }
        } finally {
            if (error) {
                if (!alreadyInTransaction) {
                    rollbackTransaction();
                }
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
    return <Props>(fn: (props: Props & { children?: React.ReactNode }, store: Store) => React.ReactNode) => {
        return class extends React.Component<Props> {
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
            }

            componentWillUmount() {
                this.isMount = false;
            }

            render() {
                const { store } = this.context;
                usingProxies = [];
                try {
                    const storeKeyIdx = store.atomStore._factoryMap.get(StoreCtor.name)!;
                    const ret = fn(this.props, getValue(store.atomStore, storeKeyIdx, StoreCtor.name) as Store);
                    this.listenedProps = usingProxies;
                    return ret;
                } finally {
                    usingProxies = void 0;
                }
            }
        };

    };
}
