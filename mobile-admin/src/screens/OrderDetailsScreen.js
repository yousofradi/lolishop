import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ordersApi } from '../api';
import { COLORS, FONTS, SIZES } from '../constants/theme';

export default function OrderDetailsScreen({ route, navigation }) {
  const [order, setOrder] = useState(route.params.order);
  const [loading, setLoading] = useState(false);

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return COLORS.warning;
      case 'shipped': return COLORS.borderFocus;
      case 'delivered': return COLORS.success;
      case 'cancelled': return COLORS.danger;
      default: return COLORS.textMuted;
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'pending': return 'قيد الانتظار';
      case 'shipped': return 'تم الشحن';
      case 'delivered': return 'تم التوصيل';
      case 'cancelled': return 'ملغى';
      default: return status;
    }
  };

  const updateStatus = async (newStatus) => {
    Alert.alert('تأكيد', `هل أنت متأكد أنك تريد تغيير حالة الطلب إلى "${getStatusText(newStatus)}"؟`, [
      { text: 'إلغاء', style: 'cancel' },
      { 
        text: 'نعم', 
        onPress: async () => {
          setLoading(true);
          try {
            await ordersApi.updateStatus([order.orderId], newStatus);
            // In a real app we'd fetch the latest order details here
            setOrder({ ...order, status: newStatus });
          } catch (err) {
            Alert.alert('خطأ', 'فشل في تحديث حالة الطلب');
          } finally {
            setLoading(false);
          }
        } 
      }
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← رجوع</Text>
        </TouchableOpacity>
        <Text style={styles.title}>طلب #{order.orderId}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        
        {/* Actions */}
        <View style={styles.actionsContainer}>
          {order.status === 'pending' && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.borderFocus }]} onPress={() => updateStatus('shipped')}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>شحن الطلب</Text>}
            </TouchableOpacity>
          )}
          {order.status === 'shipped' && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.success }]} onPress={() => updateStatus('delivered')}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>تأكيد التوصيل</Text>}
            </TouchableOpacity>
          )}
          {order.status !== 'cancelled' && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.danger, marginTop: 8 }]} onPress={() => updateStatus('cancel')}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>إلغاء الطلب</Text>}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>تفاصيل العميل</Text>
          <Text style={styles.text}>الاسم: {order.customer?.name}</Text>
          <Text style={styles.text}>الهاتف: {order.customer?.phone}</Text>
          {order.customer?.phone2 ? <Text style={styles.text}>هاتف بديل: {order.customer?.phone2}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>عنوان الشحن</Text>
          <Text style={styles.text}>{order.shippingAddress?.governorate}</Text>
          <Text style={styles.text}>{order.shippingAddress?.city} - {order.shippingAddress?.village}</Text>
          <Text style={styles.text}>{order.shippingAddress?.details}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>المنتجات</Text>
          {order.items?.map((item, index) => (
            <View key={index} style={styles.itemRow}>
              <Text style={styles.itemName}>{item.quantity}x {item.name}</Text>
              <Text style={styles.itemPrice}>{item.price} ج.م</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>ملخص الدفع</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.text}>المجموع الفرعي:</Text>
            <Text style={styles.text}>{order.subtotalPrice} ج.م</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.text}>الشحن:</Text>
            <Text style={styles.text}>{order.shippingFee} ج.م</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.text}>الخصم:</Text>
            <Text style={styles.text}>-{order.discountTotal} ج.م</Text>
          </View>
          <View style={[styles.summaryRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.borderColor }]}>
            <Text style={[styles.text, { fontFamily: FONTS.mainBold, fontSize: 18 }]}>الإجمالي:</Text>
            <Text style={[styles.text, { fontFamily: FONTS.mainBold, fontSize: 18, color: COLORS.success }]}>{order.totalPrice} ج.م</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgBody },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: COLORS.bgSurface, borderBottomWidth: 1, borderBottomColor: COLORS.borderColor },
  backBtn: { padding: 8 },
  backText: { fontFamily: FONTS.mainBold, fontSize: 16, color: COLORS.primary },
  title: { fontFamily: FONTS.mainBold, fontSize: 20, color: COLORS.textMain },
  content: { padding: 16, paddingBottom: 100 },
  actionsContainer: { marginBottom: 16 },
  actionBtn: { padding: 16, borderRadius: SIZES.radius, alignItems: 'center', justifyContent: 'center' },
  actionBtnText: { fontFamily: FONTS.mainBold, color: COLORS.white, fontSize: 16 },
  card: { backgroundColor: COLORS.bgCard, padding: 16, borderRadius: SIZES.radius, marginBottom: 16, borderWidth: 1, borderColor: COLORS.borderColor, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  sectionTitle: { fontFamily: FONTS.mainBold, fontSize: 16, color: COLORS.textMain, marginBottom: 12, textAlign: 'left' },
  text: { fontFamily: FONTS.main, fontSize: 14, color: COLORS.textMuted, marginBottom: 4, textAlign: 'left' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  itemName: { fontFamily: FONTS.main, fontSize: 14, color: COLORS.textMain, flex: 1, textAlign: 'left' },
  itemPrice: { fontFamily: FONTS.mainBold, fontSize: 14, color: COLORS.success, textAlign: 'left' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
});
