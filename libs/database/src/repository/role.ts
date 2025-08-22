import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in Role Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.ROLE]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.ROLE]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.ROLE]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.ROLE]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.ROLE]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.ROLE]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.ROLE]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.ROLE]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.ROLE]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.ROLE>;
type Model = ModelStructure[typeof MODELS_NAME.ROLE];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class Role extends BaseRepository(MODELS_NAME.ROLE) {
}

export default Role
