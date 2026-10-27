class Counter:
    def __init__(self):
        self.value = 0

    def add(self, amount):
        self.value += amount
        return self.value
