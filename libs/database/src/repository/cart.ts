import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in Cart Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.CART]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.CART]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.CART]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.CART]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.CART]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.CART]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.CART]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.CART]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.CART]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.CART>;
type Model = ModelStructure[typeof MODELS_NAME.CART];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class Cart extends BaseRepository(MODELS_NAME.CART) {
}

export default Cart
