import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in Product Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.PRODUCT]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.PRODUCT]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.PRODUCT]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.PRODUCT]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.PRODUCT]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.PRODUCT]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.PRODUCT]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.PRODUCT]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.PRODUCT]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.PRODUCT>;
type Model = ModelStructure[typeof MODELS_NAME.PRODUCT];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class Product extends BaseRepository(MODELS_NAME.PRODUCT) {
}

export default Product
