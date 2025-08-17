import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in Permission Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.PERMISSION]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.PERMISSION]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.PERMISSION]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.PERMISSION]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.PERMISSION]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.PERMISSION]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.PERMISSION]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.PERMISSION]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.PERMISSION]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.PERMISSION>;
type Model = ModelStructure[typeof MODELS_NAME.PERMISSION];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class Permission extends BaseRepository(MODELS_NAME.PERMISSION) {
}

export default Permission
