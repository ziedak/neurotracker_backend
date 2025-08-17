import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in UserRole Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.USER_ROLE]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.USER_ROLE]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.USER_ROLE]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.USER_ROLE]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.USER_ROLE]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.USER_ROLE]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.USER_ROLE]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.USER_ROLE]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.USER_ROLE]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.USER_ROLE>;
type Model = ModelStructure[typeof MODELS_NAME.USER_ROLE];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class UserRole extends BaseRepository(MODELS_NAME.USER_ROLE) {
}

export default UserRole
