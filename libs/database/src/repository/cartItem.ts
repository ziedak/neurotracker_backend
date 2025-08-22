import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in CartItem Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.CART_ITEM]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.CART_ITEM]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.CART_ITEM]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.CART_ITEM]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.CART_ITEM]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.CART_ITEM]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.CART_ITEM]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.CART_ITEM]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.CART_ITEM]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.CART_ITEM>;
type Model = ModelStructure[typeof MODELS_NAME.CART_ITEM];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class CartItem extends BaseRepository(MODELS_NAME.CART_ITEM) {
}

export default CartItem
