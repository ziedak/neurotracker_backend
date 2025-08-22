import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in RolePermission Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.ROLE_PERMISSION]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.ROLE_PERMISSION]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.ROLE_PERMISSION]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.ROLE_PERMISSION]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.ROLE_PERMISSION]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.ROLE_PERMISSION]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.ROLE_PERMISSION]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.ROLE_PERMISSION]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.ROLE_PERMISSION]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.ROLE_PERMISSION>;
type Model = ModelStructure[typeof MODELS_NAME.ROLE_PERMISSION];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class RolePermission extends BaseRepository(MODELS_NAME.ROLE_PERMISSION) {
}

export default RolePermission
