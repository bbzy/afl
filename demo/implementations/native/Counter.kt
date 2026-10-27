class Counter {
    private var value = 0

    fun add(amount: Int): Int {
        value += amount
        return value
    }
}
