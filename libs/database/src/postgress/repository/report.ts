import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in Report Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.REPORT]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.REPORT]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.REPORT]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.REPORT]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.REPORT]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.REPORT]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.REPORT]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.REPORT]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.REPORT]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.REPORT>;
type Model = ModelStructure[typeof MODELS_NAME.REPORT];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class Report extends BaseRepository(MODELS_NAME.REPORT) {
}

export default Report
