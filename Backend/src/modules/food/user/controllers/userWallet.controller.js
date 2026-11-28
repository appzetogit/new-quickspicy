import { sendResponse } from '../../../../utils/response.js';
import { getUserWallet, createWalletTopupOrder, verifyWalletTopupPayment } from '../services/userWallet.service.js';
import { isRazorpayConfigured } from '../../orders/helpers/razorpay.helper.js';

export const getUserWalletController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const wallet = await getUserWallet(userId);
        // Lets the app disable Add Money up front instead of failing on tap (166).
        return sendResponse(res, 200, 'Wallet fetched successfully', {
            wallet: { ...wallet, walletTopupEnabled: isRazorpayConfigured() },
        });
    } catch (error) {
        next(error);
    }
};

export const createWalletTopupOrderController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const amount = req.body?.amount;
        const data = await createWalletTopupOrder(userId, amount);
        return sendResponse(res, 200, 'Top-up order created successfully', data);
    } catch (error) {
        next(error);
    }
};

export const verifyWalletTopupPaymentController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const data = await verifyWalletTopupPayment(userId, req.body || {});
        return sendResponse(res, 200, 'Payment verified successfully', data);
    } catch (error) {
        next(error);
    }
};

