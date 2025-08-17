import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in SessionLog Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.SESSION_LOG]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.SESSION_LOG]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.SESSION_LOG]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.SESSION_LOG]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.SESSION_LOG]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.SESSION_LOG]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.SESSION_LOG]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.SESSION_LOG]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.SESSION_LOG]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.SESSION_LOG>;
type Model = ModelStructure[typeof MODELS_NAME.SESSION_LOG];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class SessionLog extends BaseRepository(MODELS_NAME.SESSION_LOG) {
}

export default SessionLog
