import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in User Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.USER]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.USER]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.USER]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.USER]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.USER]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.USER]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.USER]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.USER]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.USER]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.USER>;
type Model = ModelStructure[typeof MODELS_NAME.USER];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class User extends BaseRepository(MODELS_NAME.USER) {
}

export default User
