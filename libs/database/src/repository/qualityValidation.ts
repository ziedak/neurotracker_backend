import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in QualityValidation Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.QUALITY_VALIDATION]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.QUALITY_VALIDATION]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.QUALITY_VALIDATION]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.QUALITY_VALIDATION]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.QUALITY_VALIDATION]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.QUALITY_VALIDATION]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.QUALITY_VALIDATION]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.QUALITY_VALIDATION]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.QUALITY_VALIDATION]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.QUALITY_VALIDATION>;
type Model = ModelStructure[typeof MODELS_NAME.QUALITY_VALIDATION];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class QualityValidation extends BaseRepository(MODELS_NAME.QUALITY_VALIDATION) {
}

export default QualityValidation
