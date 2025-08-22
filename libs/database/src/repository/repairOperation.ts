import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in RepairOperation Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.REPAIR_OPERATION]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.REPAIR_OPERATION]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.REPAIR_OPERATION]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.REPAIR_OPERATION]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.REPAIR_OPERATION]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.REPAIR_OPERATION]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.REPAIR_OPERATION]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.REPAIR_OPERATION]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.REPAIR_OPERATION]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.REPAIR_OPERATION>;
type Model = ModelStructure[typeof MODELS_NAME.REPAIR_OPERATION];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class RepairOperation extends BaseRepository(MODELS_NAME.REPAIR_OPERATION) {
}

export default RepairOperation
