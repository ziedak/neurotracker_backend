import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in Notification Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.NOTIFICATION]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.NOTIFICATION]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.NOTIFICATION]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.NOTIFICATION]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.NOTIFICATION]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.NOTIFICATION]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.NOTIFICATION]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.NOTIFICATION]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.NOTIFICATION]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.NOTIFICATION>;
type Model = ModelStructure[typeof MODELS_NAME.NOTIFICATION];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class Notification extends BaseRepository(MODELS_NAME.NOTIFICATION) {
}

export default Notification
