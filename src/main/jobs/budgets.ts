import { HostBudgets } from '../../core/hostBudget';

/** What each file host may be asked for at once (core/hostBudget.ts). One set for the whole app: the queue decides how many files, aria2 how many connections. */
export const hostBudgets = new HostBudgets();
