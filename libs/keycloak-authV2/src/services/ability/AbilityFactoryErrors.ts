/**
 * Error hierarchy for ability factory operations
 */

export class AbilityFactoryError extends Error {
  constructor(message: string, public override cause?: Error) {
    super(message);
    this.name = "AbilityFactoryError";
  }
}

export class AbilityCacheError extends AbilityFactoryError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = "AbilityCacheError";
  }
}

export class AbilityValidationError extends AbilityFactoryError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = "AbilityValidationError";
  }
}

export class AbilityComputationError extends AbilityFactoryError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = "AbilityComputationError";
  }
}

export class TemplateProcessingError extends AbilityFactoryError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = "TemplateProcessingError";
  }
}
