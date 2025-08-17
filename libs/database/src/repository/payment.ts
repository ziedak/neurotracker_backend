import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in Payment Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.PAYMENT]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.PAYMENT]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.PAYMENT]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.PAYMENT]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.PAYMENT]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.PAYMENT]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.PAYMENT]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.PAYMENT]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.PAYMENT]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.PAYMENT>;
type Model = ModelStructure[typeof MODELS_NAME.PAYMENT];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class Payment extends BaseRepository(MODELS_NAME.PAYMENT) {
}

export default Payment
