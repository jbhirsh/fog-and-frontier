import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@apollo/client/react';
import { USERS_QUERY } from '../lib/gqlDocs';
import { PersonLabelCtx, namesByEmail, personLabel } from '../lib/people';
import { useOwner } from '../lib/useOwner';

/**
 * Names people by their first name for everything below it, from the users
 * list, which any signed-in account may read. A signed-out visitor is shown
 * no one by email (contributors, members and suggestions are signed-in
 * reads; reviews carry their author's name), so nothing is asked for them.
 */
export function PeopleProvider({ children }: { children: ReactNode }) {
  const { email } = useOwner();
  const { data } = useQuery(USERS_QUERY, { skip: !email });
  const users = data?.users;
  const label = useMemo(() => {
    const names = namesByEmail(users ?? []);
    return (who: string) => personLabel(who, names);
  }, [users]);
  return <PersonLabelCtx.Provider value={label}>{children}</PersonLabelCtx.Provider>;
}
