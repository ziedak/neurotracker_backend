import _ from "lodash";
import BaseRepository from "./baseRepository";
import {
  AnyRecord,
  ModelStructure,
  ModelTypes,
  ModelScalarFields,
  MODELS_NAME,
} from "./prisma-repo";

// This type will be used if you want to extends the functions in ApiKey Class

/* eslint-disable @typescript-eslint/no-unused-vars */
type Where = ModelTypes[typeof MODELS_NAME.API_KEY]["Where"];
type Select = ModelTypes[typeof MODELS_NAME.API_KEY]["Select"];
type Include = ModelTypes[typeof MODELS_NAME.API_KEY]["Include"];
type Create = ModelTypes[typeof MODELS_NAME.API_KEY]["Create"];
type Update = ModelTypes[typeof MODELS_NAME.API_KEY]["Update"];
type Cursor = ModelTypes[typeof MODELS_NAME.API_KEY]["Cursor"];
type Order = ModelTypes[typeof MODELS_NAME.API_KEY]["Order"];
type Delegate = ModelTypes[typeof MODELS_NAME.API_KEY]["Delegate"];
type GroupBy = ModelTypes[typeof MODELS_NAME.API_KEY]["GroupBy"];
type Scalar = ModelScalarFields<typeof MODELS_NAME.API_KEY>;
type Model = ModelStructure[typeof MODELS_NAME.API_KEY];
/*  eslint-enable @typescript-eslint/no-unused-vars */

class ApiKey extends BaseRepository(MODELS_NAME.API_KEY) {}

export default ApiKey;
