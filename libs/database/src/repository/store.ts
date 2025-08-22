import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in Store Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.STORE]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.STORE]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.STORE]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.STORE]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.STORE]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.STORE]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.STORE]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.STORE]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.STORE]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.STORE>;
type Model = ModelStructure[typeof MODELS_NAME.STORE];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class Store extends BaseRepository(MODELS_NAME.STORE) {
}

export default Store
