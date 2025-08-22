import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in UserSession Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.USER_SESSION]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.USER_SESSION]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.USER_SESSION]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.USER_SESSION]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.USER_SESSION]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.USER_SESSION]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.USER_SESSION]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.USER_SESSION]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.USER_SESSION]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.USER_SESSION>;
type Model = ModelStructure[typeof MODELS_NAME.USER_SESSION];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class UserSession extends BaseRepository(MODELS_NAME.USER_SESSION) {
}

export default UserSession
