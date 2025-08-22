import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in Config Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.CONFIG]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.CONFIG]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.CONFIG]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.CONFIG]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.CONFIG]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.CONFIG]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.CONFIG]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.CONFIG]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.CONFIG]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.CONFIG>;
type Model = ModelStructure[typeof MODELS_NAME.CONFIG];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class Config extends BaseRepository(MODELS_NAME.CONFIG) {
}

export default Config
