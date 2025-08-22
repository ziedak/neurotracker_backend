import _ from 'lodash';
import BaseRepository from './baseRepository';
import { AnyRecord, ModelStructure, ModelTypes, ModelScalarFields, MODELS_NAME } from './prisma-repo';

// This type will be used if you want to extends the functions in ReconciliationRule Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.RECONCILIATION_RULE]['Where'];
type Select = ModelTypes[typeof MODELS_NAME.RECONCILIATION_RULE]['Select'];
type Include = ModelTypes[typeof MODELS_NAME.RECONCILIATION_RULE]['Include'];
type Create = ModelTypes[typeof MODELS_NAME.RECONCILIATION_RULE]['Create'];
type Update = ModelTypes[typeof MODELS_NAME.RECONCILIATION_RULE]['Update'];
type Cursor = ModelTypes[typeof MODELS_NAME.RECONCILIATION_RULE]['Cursor'];
type Order = ModelTypes[typeof MODELS_NAME.RECONCILIATION_RULE]['Order'];
type Delegate = ModelTypes[typeof MODELS_NAME.RECONCILIATION_RULE]['Delegate'];
type GroupBy = ModelTypes[typeof MODELS_NAME.RECONCILIATION_RULE]['GroupBy'];
type Scalar = ModelScalarFields<typeof MODELS_NAME.RECONCILIATION_RULE>;
type Model = ModelStructure[typeof MODELS_NAME.RECONCILIATION_RULE];
/*  eslint-enable @typescript-eslint/no-unused-vars */


class ReconciliationRule extends BaseRepository(MODELS_NAME.RECONCILIATION_RULE) {
}

export default ReconciliationRule
