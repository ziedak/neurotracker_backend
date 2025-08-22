import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in SessionActivity Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.SESSION_ACTIVITY]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.SESSION_ACTIVITY]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.SESSION_ACTIVITY]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.SESSION_ACTIVITY]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.SESSION_ACTIVITY]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.SESSION_ACTIVITY]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.SESSION_ACTIVITY]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.SESSION_ACTIVITY]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.SESSION_ACTIVITY]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.SESSION_ACTIVITY>;
type Model = ModelStructure[typeof MODELS_NAME.SESSION_ACTIVITY];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class SessionActivity extends BaseRepository(MODELS_NAME.SESSION_ACTIVITY) {
}

export default SessionActivity
