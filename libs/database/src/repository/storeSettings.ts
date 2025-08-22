import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in StoreSettings Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.STORE_SETTINGS]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.STORE_SETTINGS]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.STORE_SETTINGS]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.STORE_SETTINGS]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.STORE_SETTINGS]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.STORE_SETTINGS]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.STORE_SETTINGS]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.STORE_SETTINGS]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.STORE_SETTINGS]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.STORE_SETTINGS>;
type Model = ModelStructure[typeof MODELS_NAME.STORE_SETTINGS];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class StoreSettings extends BaseRepository(MODELS_NAME.STORE_SETTINGS) {
}

export default StoreSettings
