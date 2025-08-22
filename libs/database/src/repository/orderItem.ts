import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in OrderItem Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.ORDER_ITEM]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.ORDER_ITEM]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.ORDER_ITEM]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.ORDER_ITEM]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.ORDER_ITEM]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.ORDER_ITEM]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.ORDER_ITEM]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.ORDER_ITEM]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.ORDER_ITEM]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.ORDER_ITEM>;
type Model = ModelStructure[typeof MODELS_NAME.ORDER_ITEM];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class OrderItem extends BaseRepository(MODELS_NAME.ORDER_ITEM) {
}

export default OrderItem
