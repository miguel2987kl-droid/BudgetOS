import cron from 'node-cron';
import knex from '../database/connection.js';
import PlannedTransaction from '../models/PlannedTransaction.js';
import logger from '../utils/logger.js';
import { formatDateISO } from '../utils/helpers.js';

/**
 * Scheduler service for recurring transactions
 */
class SchedulerService {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Start the scheduler
   */
  start() {
    // Run every hour
    cron.schedule('0 * * * *', () => {
      this.processPlannedTransactions();
    });

    // Clean up expired password reset tokens daily at 3:00 AM
    cron.schedule('0 3 * * *', () => {
      this.cleanupExpiredTokens();
    });

    // Purge archived clients past their retention window (RN-16) daily at 3:30 AM
    cron.schedule('30 3 * * *', () => {
      this.purgeArchivedWorkspaces();
    });

    // Also run on server start
    setTimeout(() => {
      this.processPlannedTransactions();
    }, 5000);

    logger.info('Scheduler started - checking planned transactions every hour');
  }

  /**
   * Process due planned transactions
   */
  async processPlannedTransactions() {
    if (this.isRunning) {
      logger.info('Scheduler already running, skipping');
      return;
    }

    this.isRunning = true;
    const today = formatDateISO(new Date());

    try {
      // Get all active planned transactions due today or earlier
      const duePlanned = await knex('planned_transactions as pt')
        .join('users as u', 'pt.user_id', 'u.id')
        .join('accounts as a', 'pt.account_id', 'a.id')
        .select('pt.*', 'u.id as user_id')
        .where('pt.is_active', true)
        .where('a.is_active', true)
        .whereNotNull('pt.next_occurrence')
        .where('pt.next_occurrence', '<=', today)
        .where(function () {
          this.whereNull('pt.end_date').orWhereRaw('pt.end_date >= pt.next_occurrence');
        })
        .where(function () {
          this.whereNull('pt.max_occurrences').orWhereRaw('pt.occurrences_created < pt.max_occurrences');
        });

      logger.info(`Found ${duePlanned.length} planned transactions due`);

      for (const pt of duePlanned) {
        try {
          // Adjust date for holidays if needed
          let executionDate = pt.next_occurrence;

          if (pt.execute_before_holiday) {
            executionDate = this.getLastBusinessDay(pt.next_occurrence);
          }

          // Create the transaction
          await PlannedTransaction.createOccurrence(pt.id, pt.user_id, executionDate);

          logger.info(`Created transaction for planned ${pt.id}: ${pt.description}`);

          // Check if planned transaction should be deactivated or deleted
          if (pt.end_date) {
            const updatedPt = await knex('planned_transactions')
              .where('id', pt.id)
              .select('next_occurrence', 'delete_on_end')
              .first();

            if (updatedPt && updatedPt.next_occurrence && updatedPt.next_occurrence > pt.end_date) {
              if (updatedPt.delete_on_end) {
                await knex('planned_transactions').where('id', pt.id).del();
                logger.info(`Deleted planned ${pt.id}: end date reached (delete_on_end enabled)`);
              } else {
                await knex('planned_transactions').where('id', pt.id).update({ is_active: false });
                logger.info(`Deactivated planned ${pt.id}: end date reached`);
              }
            }
          }
        } catch (error) {
          logger.error(`Error creating occurrence for planned ${pt.id}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error processing planned transactions:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Clean up expired password reset tokens
   */
  async cleanupExpiredTokens() {
    try {
      const { default: PasswordResetToken } = await import('../models/PasswordResetToken.js');
      const deleted = await PasswordResetToken.deleteExpired();
      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} expired password reset tokens`);
      }
    } catch (error) {
      logger.error('Error cleaning up expired tokens:', error);
    }
  }

  /**
   * Permanently remove clients archived longer than the retention window
   */
  async purgeArchivedWorkspaces() {
    try {
      const { default: ClientWorkspace } = await import('../models/ClientWorkspace.js');
      const { getRetentionDays } = await import('../controllers/financeController.js');
      const purged = await ClientWorkspace.purgeExpired(await getRetentionDays());
      if (purged > 0) {
        logger.info(`Purged ${purged} archived client workspaces`);
      }
    } catch (error) {
      logger.error('Error purging archived workspaces:', error);
    }
  }

  /**
   * Get last business day before or on the given date
   */
  getLastBusinessDay(dateStr) {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const holidays = this.getFrenchHolidays(year);

    while (this.isWeekend(date) || this.isHoliday(date, holidays)) {
      date.setDate(date.getDate() - 1);
    }

    return formatDateISO(date);
  }

  isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  isHoliday(date, holidays) {
    const dateStr = formatDateISO(date);
    return holidays.includes(dateStr);
  }

  getFrenchHolidays(year) {
    const holidays = [
      `${year}-01-01`, `${year}-05-01`, `${year}-05-08`,
      `${year}-07-14`, `${year}-08-15`, `${year}-11-01`,
      `${year}-11-11`, `${year}-12-25`,
    ];

    const easter = this.getEasterDate(year);

    const easterMonday = new Date(easter);
    easterMonday.setDate(easterMonday.getDate() + 1);
    holidays.push(formatDateISO(easterMonday));

    const ascension = new Date(easter);
    ascension.setDate(ascension.getDate() + 39);
    holidays.push(formatDateISO(ascension));

    const pentecost = new Date(easter);
    pentecost.setDate(pentecost.getDate() + 50);
    holidays.push(formatDateISO(pentecost));

    return holidays;
  }

  getEasterDate(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    return new Date(year, month - 1, day);
  }
}

export const schedulerService = new SchedulerService();
export default schedulerService;
