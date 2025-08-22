import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in QualityAnomaly Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.QUALITY_ANOMALY]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.QUALITY_ANOMALY]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.QUALITY_ANOMALY]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.QUALITY_ANOMALY]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.QUALITY_ANOMALY]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.QUALITY_ANOMALY]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.QUALITY_ANOMALY]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.QUALITY_ANOMALY]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.QUALITY_ANOMALY]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.QUALITY_ANOMALY>;
type Model = ModelStructure[typeof MODELS_NAME.QUALITY_ANOMALY];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class QualityAnomaly extends BaseRepository(MODELS_NAME.QUALITY_ANOMALY) {
}

export default QualityAnomaly
