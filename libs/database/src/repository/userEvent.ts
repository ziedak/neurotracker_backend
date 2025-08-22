import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in UserEvent Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.USER_EVENT]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.USER_EVENT]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.USER_EVENT]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.USER_EVENT]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.USER_EVENT]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.USER_EVENT]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.USER_EVENT]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.USER_EVENT]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.USER_EVENT]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.USER_EVENT>;
type Model = ModelStructure[typeof MODELS_NAME.USER_EVENT];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class UserEvent extends BaseRepository(MODELS_NAME.USER_EVENT) {
}

export default UserEvent
