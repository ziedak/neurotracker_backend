import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in Feature Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.FEATURE]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.FEATURE]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.FEATURE]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.FEATURE]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.FEATURE]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.FEATURE]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.FEATURE]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.FEATURE]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.FEATURE]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.FEATURE>;
type Model = ModelStructure[typeof MODELS_NAME.FEATURE];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class Feature extends BaseRepository(MODELS_NAME.FEATURE) {
}

export default Feature
