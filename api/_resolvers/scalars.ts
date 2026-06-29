import {
  DateResolver,
  DateTimeISOResolver,
  LocalTimeResolver,
} from 'graphql-scalars';

// Custom scalar implementations wired to the SDL `scalar` declarations
// (api/_schema.ts). DateTimeISO serializes DB epoch-ms numbers straight to ISO;
// Date is 'YYYY-MM-DD'; LocalTime is 'HH:MM'.
export const scalarResolvers = {
  DateTimeISO: DateTimeISOResolver,
  Date: DateResolver,
  LocalTime: LocalTimeResolver,
};
