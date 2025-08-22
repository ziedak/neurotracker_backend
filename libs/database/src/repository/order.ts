import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in Order Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.ORDER]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.ORDER]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.ORDER]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.ORDER]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.ORDER]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.ORDER]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.ORDER]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.ORDER]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.ORDER]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.ORDER>;
type Model = ModelStructure[typeof MODELS_NAME.ORDER];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class Order extends BaseRepository(MODELS_NAME.ORDER) {
}

export default Order
