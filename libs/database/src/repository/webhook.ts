import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in Webhook Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.WEBHOOK]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.WEBHOOK]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.WEBHOOK]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.WEBHOOK]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.WEBHOOK]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.WEBHOOK]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.WEBHOOK]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.WEBHOOK]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.WEBHOOK]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.WEBHOOK>;
type Model = ModelStructure[typeof MODELS_NAME.WEBHOOK];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class Webhook extends BaseRepository(MODELS_NAME.WEBHOOK) {
}

export default Webhook
